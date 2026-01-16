//! Higher-level sandbox abstraction that returns an exec-able interface.
//!
//! This module provides a simpler API for creating sandboxes and executing
//! commands within them, abstracting away the details of bubblewrap and nsenter.
//!
//! # Example
//!
//! ```ignore
//! use cmux_sandbox::{SandboxBuilder, SandboxHandle};
//!
//! async fn example() -> Result<(), Box<dyn std::error::Error>> {
//!     // Create a sandbox
//!     let sandbox = SandboxBuilder::new()
//!         .name("my-sandbox")
//!         .workspace("/path/to/workspace")
//!         .build()
//!         .await?;
//!
//!     // Execute commands
//!     let output = sandbox.exec(&["ls", "-la"]).await?;
//!     println!("stdout: {}", output.stdout);
//!
//!     // Get the exec URL for external tools
//!     let url = sandbox.exec_url();
//!     println!("Connect via: {}", url);
//!
//!     // Cleanup when done
//!     sandbox.destroy().await?;
//!     Ok(())
//! }
//! ```

use crate::bubblewrap::BubblewrapService;
use crate::errors::SandboxResult;
use crate::models::{CreateSandboxRequest, EnvVar, ExecRequest, SandboxSummary};
use crate::service::SandboxService;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::debug;

/// Output from executing a command in the sandbox.
#[derive(Debug, Clone)]
pub struct ExecOutput {
    /// Exit code of the command (0 typically means success)
    pub exit_code: i32,
    /// Standard output from the command
    pub stdout: String,
    /// Standard error from the command
    pub stderr: String,
}

impl ExecOutput {
    /// Returns true if the command succeeded (exit code 0)
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }
}

/// A handle to a running sandbox that provides an exec-able interface.
///
/// This is the main abstraction for interacting with sandboxes. Once you have
/// a handle, you can execute commands, spawn processes, and eventually destroy
/// the sandbox when done.
#[derive(Clone)]
pub struct SandboxHandle {
    /// The sandbox ID (UUID as string)
    id: String,
    /// Sandbox summary with network info, workspace, etc.
    summary: SandboxSummary,
    /// Reference to the underlying service for exec operations
    service: Arc<dyn SandboxService>,
    /// Environment variables to inject into all commands
    env: Vec<EnvVar>,
}

impl SandboxHandle {
    /// Returns the sandbox's unique identifier.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Returns the sandbox's name.
    pub fn name(&self) -> &str {
        &self.summary.name
    }

    /// Returns the workspace path mounted at /workspace inside the sandbox.
    pub fn workspace(&self) -> &str {
        &self.summary.workspace
    }

    /// Returns the sandbox's IP address within the isolated network.
    pub fn ip_address(&self) -> &str {
        &self.summary.network.sandbox_ip
    }

    /// Returns an "exec URL" that can be used by external tools to connect.
    ///
    /// For local bubblewrap sandboxes, this returns a nsenter-style URI:
    /// `nsenter://<sandbox-id>`
    ///
    /// This can be used as a handle for tools that need a connection string.
    pub fn exec_url(&self) -> String {
        format!("nsenter://{}", self.id)
    }

    /// Returns the full sandbox summary with all metadata.
    pub fn summary(&self) -> &SandboxSummary {
        &self.summary
    }

    /// Execute a command in the sandbox and wait for it to complete.
    ///
    /// # Arguments
    ///
    /// * `args` - Command and arguments to execute
    ///
    /// # Example
    ///
    /// ```ignore
    /// let output = sandbox.exec(&["echo", "hello world"]).await?;
    /// assert!(output.success());
    /// assert_eq!(output.stdout.trim(), "hello world");
    /// ```
    pub async fn exec(&self, args: &[&str]) -> SandboxResult<ExecOutput> {
        self.exec_with_options(args, None, &[]).await
    }

    /// Execute a command in the sandbox with additional options.
    ///
    /// # Arguments
    ///
    /// * `args` - Command and arguments to execute
    /// * `workdir` - Optional working directory (defaults to /workspace)
    /// * `env` - Additional environment variables
    pub async fn exec_with_options(
        &self,
        args: &[&str],
        workdir: Option<&str>,
        env: &[(&str, &str)],
    ) -> SandboxResult<ExecOutput> {
        let command: Vec<String> = args.iter().map(|s| s.to_string()).collect();

        let mut exec_env: Vec<EnvVar> = self.env.clone();
        for (key, value) in env {
            exec_env.push(EnvVar {
                key: key.to_string(),
                value: value.to_string(),
            });
        }

        let req = ExecRequest {
            command,
            workdir: workdir.map(String::from),
            env: exec_env,
        };

        let response = self.service.exec(self.id.clone(), req).await?;

        Ok(ExecOutput {
            exit_code: response.exit_code,
            stdout: response.stdout,
            stderr: response.stderr,
        })
    }

    /// Execute a shell command string in the sandbox.
    ///
    /// This is a convenience method that wraps the command in `/bin/sh -c`.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let output = sandbox.shell("ls -la && pwd").await?;
    /// ```
    pub async fn shell(&self, command: &str) -> SandboxResult<ExecOutput> {
        self.exec(&["/bin/sh", "-c", command]).await
    }

    /// Destroy the sandbox and clean up resources.
    ///
    /// After calling this, the handle should not be used.
    pub async fn destroy(self) -> SandboxResult<()> {
        self.service.delete(self.id).await?;
        Ok(())
    }
}

impl std::fmt::Debug for SandboxHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SandboxHandle")
            .field("id", &self.id)
            .field("name", &self.summary.name)
            .field("workspace", &self.summary.workspace)
            .field("ip", &self.summary.network.sandbox_ip)
            .finish()
    }
}

/// Builder for creating sandbox handles with a fluent API.
///
/// # Example
///
/// ```ignore
/// use cmux_sandbox::SandboxBuilder;
///
/// async fn example() -> Result<(), Box<dyn std::error::Error>> {
///     let sandbox = SandboxBuilder::new()
///         .name("my-sandbox")
///         .workspace("/path/to/project")
///         .env("DEBUG", "1")
///         .env("MY_VAR", "value")
///         .build()
///         .await?;
///     Ok(())
/// }
/// ```
pub struct SandboxBuilder {
    name: Option<String>,
    workspace: Option<String>,
    data_dir: PathBuf,
    port: u16,
    env: Vec<EnvVar>,
    read_only_paths: Vec<String>,
    tmpfs: Vec<String>,
}

impl Default for SandboxBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl SandboxBuilder {
    /// Create a new sandbox builder with default settings.
    pub fn new() -> Self {
        Self {
            name: None,
            workspace: None,
            data_dir: PathBuf::from("/var/lib/sandbox"),
            port: 46831,
            env: Vec::new(),
            read_only_paths: Vec::new(),
            tmpfs: Vec::new(),
        }
    }

    /// Set the sandbox name (optional, auto-generated if not set).
    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set the host workspace path to mount at /workspace in the sandbox.
    pub fn workspace(mut self, path: impl Into<String>) -> Self {
        self.workspace = Some(path.into());
        self
    }

    /// Set the data directory where sandbox state is stored.
    pub fn data_dir(mut self, path: impl Into<PathBuf>) -> Self {
        self.data_dir = path.into();
        self
    }

    /// Set the port for the sandbox service (default: 46831).
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Add an environment variable to inject into the sandbox.
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push(EnvVar {
            key: key.into(),
            value: value.into(),
        });
        self
    }

    /// Add a read-only bind mount.
    pub fn read_only(mut self, path: impl Into<String>) -> Self {
        self.read_only_paths.push(path.into());
        self
    }

    /// Add a tmpfs mount point.
    pub fn tmpfs(mut self, path: impl Into<String>) -> Self {
        self.tmpfs.push(path.into());
        self
    }

    /// Build the sandbox and return a handle.
    ///
    /// This creates a new isolated sandbox using bubblewrap with its own
    /// network namespace, filesystem overlays, and process isolation.
    pub async fn build(self) -> SandboxResult<SandboxHandle> {
        debug!(
            "Creating sandbox with data_dir={:?}, port={}",
            self.data_dir, self.port
        );

        let service = Arc::new(BubblewrapService::new(self.data_dir, self.port).await?);

        let request = CreateSandboxRequest {
            name: self.name,
            workspace: self.workspace,
            tab_id: None,
            read_only_paths: self.read_only_paths,
            tmpfs: self.tmpfs,
            env: self.env.clone(),
        };

        let summary = service.create(request).await?;
        let id = summary.id.to_string();

        Ok(SandboxHandle {
            id,
            summary,
            service,
            env: self.env,
        })
    }
}

/// A pool of sandbox handles for managing multiple sandboxes.
///
/// This is useful when you need to manage the lifecycle of multiple sandboxes
/// from a single service instance.
pub struct SandboxPool {
    service: Arc<BubblewrapService>,
    handles: Mutex<HashMap<String, SandboxSummary>>,
    default_env: Vec<EnvVar>,
}

impl SandboxPool {
    /// Create a new sandbox pool.
    ///
    /// # Arguments
    ///
    /// * `data_dir` - Directory for storing sandbox state
    /// * `port` - Port for the sandbox service
    pub async fn new(data_dir: impl Into<PathBuf>, port: u16) -> SandboxResult<Self> {
        let service = Arc::new(BubblewrapService::new(data_dir.into(), port).await?);

        Ok(Self {
            service,
            handles: Mutex::new(HashMap::new()),
            default_env: Vec::new(),
        })
    }

    /// Set default environment variables for all sandboxes created from this pool.
    pub fn with_env(mut self, env: Vec<EnvVar>) -> Self {
        self.default_env = env;
        self
    }

    /// Create a new sandbox and return a handle.
    pub async fn create(
        &self,
        name: Option<&str>,
        workspace: Option<&str>,
    ) -> SandboxResult<SandboxHandle> {
        let request = CreateSandboxRequest {
            name: name.map(String::from),
            workspace: workspace.map(String::from),
            tab_id: None,
            read_only_paths: Vec::new(),
            tmpfs: Vec::new(),
            env: self.default_env.clone(),
        };

        let summary = self.service.create(request).await?;
        let id = summary.id.to_string();

        {
            let mut handles = self.handles.lock().await;
            handles.insert(id.clone(), summary.clone());
        }

        Ok(SandboxHandle {
            id,
            summary,
            service: self.service.clone(),
            env: self.default_env.clone(),
        })
    }

    /// Get a handle to an existing sandbox by ID.
    pub async fn get(&self, id: &str) -> SandboxResult<Option<SandboxHandle>> {
        let summary = self.service.get(id.to_string()).await?;

        Ok(summary.map(|s| SandboxHandle {
            id: s.id.to_string(),
            summary: s,
            service: self.service.clone(),
            env: self.default_env.clone(),
        }))
    }

    /// List all sandboxes in the pool.
    pub async fn list(&self) -> SandboxResult<Vec<SandboxHandle>> {
        let summaries = self.service.list().await?;

        Ok(summaries
            .into_iter()
            .map(|s| SandboxHandle {
                id: s.id.to_string(),
                summary: s,
                service: self.service.clone(),
                env: self.default_env.clone(),
            })
            .collect())
    }

    /// Destroy a sandbox by ID.
    pub async fn destroy(&self, id: &str) -> SandboxResult<()> {
        self.service.delete(id.to_string()).await?;

        {
            let mut handles = self.handles.lock().await;
            handles.remove(id);
        }

        Ok(())
    }

    /// Destroy all sandboxes in the pool.
    pub async fn destroy_all(&self) -> SandboxResult<()> {
        let sandboxes = self.service.list().await?;

        for sandbox in sandboxes {
            if let Err(e) = self.service.delete(sandbox.id.to_string()).await {
                tracing::warn!("Failed to destroy sandbox {}: {}", sandbox.id, e);
            }
        }

        {
            let mut handles = self.handles.lock().await;
            handles.clear();
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires bubblewrap and root privileges"]
    async fn test_sandbox_exec() {
        let sandbox = SandboxBuilder::new()
            .name("test-exec")
            .data_dir("/tmp/sandbox-test")
            .build()
            .await
            .expect("Failed to create sandbox");

        let output = sandbox
            .exec(&["echo", "hello"])
            .await
            .expect("Failed to exec");
        assert!(output.success());
        assert_eq!(output.stdout.trim(), "hello");

        sandbox.destroy().await.expect("Failed to destroy");
    }

    #[tokio::test]
    #[ignore = "requires bubblewrap and root privileges"]
    async fn test_sandbox_shell() {
        let sandbox = SandboxBuilder::new()
            .name("test-shell")
            .data_dir("/tmp/sandbox-test")
            .build()
            .await
            .expect("Failed to create sandbox");

        let output = sandbox
            .shell("echo $((1 + 2))")
            .await
            .expect("Failed to exec shell");
        assert!(output.success());
        assert_eq!(output.stdout.trim(), "3");

        sandbox.destroy().await.expect("Failed to destroy");
    }
}
