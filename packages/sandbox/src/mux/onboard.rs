//! Onboarding module for Docker image management in the TUI.
//!
//! This module handles checking for Docker images, querying image sizes,
//! and displaying download progress during first-run setup.

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

/// The state of the onboarding process.
#[derive(Debug, Clone, Default)]
pub struct OnboardState {
    /// Whether the onboarding overlay is visible
    pub is_visible: bool,
    /// Current phase of onboarding
    pub phase: OnboardPhase,
    /// The Docker image name being checked/downloaded
    pub image_name: String,
    /// The size of the image in bytes (if known)
    pub image_size: Option<u64>,
    /// Download progress (0.0 to 1.0)
    pub download_progress: f32,
    /// Current download status message
    pub download_status: String,
    /// Number of layers downloaded
    pub layers_downloaded: usize,
    /// Total number of layers
    pub layers_total: usize,
    /// Selected button (0 = Download, 1 = Cancel)
    pub selected_button: usize,
    /// Error message if something went wrong
    pub error: Option<String>,
}

/// The current phase of the onboarding process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum OnboardPhase {
    /// Initial state, checking if image exists
    #[default]
    CheckingImage,
    /// Image exists, onboarding complete
    ImageExists,
    /// Image not found, prompting user to download
    PromptDownload,
    /// Download in progress
    Downloading,
    /// Download completed successfully
    DownloadComplete,
    /// An error occurred
    Error,
}

impl OnboardState {
    pub fn new(image_name: String) -> Self {
        Self {
            is_visible: true,
            phase: OnboardPhase::CheckingImage,
            image_name,
            image_size: None,
            download_progress: 0.0,
            download_status: "Checking Docker image...".to_string(),
            layers_downloaded: 0,
            layers_total: 0,
            selected_button: 0,
            error: None,
        }
    }

    /// Format the image size for display.
    pub fn format_size(&self) -> String {
        match self.image_size {
            Some(bytes) => {
                if bytes >= 1_000_000_000 {
                    format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
                } else if bytes >= 1_000_000 {
                    format!("{:.1} MB", bytes as f64 / 1_000_000.0)
                } else if bytes >= 1_000 {
                    format!("{:.1} KB", bytes as f64 / 1_000.0)
                } else {
                    format!("{} bytes", bytes)
                }
            }
            None => "Unknown size".to_string(),
        }
    }

    /// Toggle between Download and Cancel buttons.
    pub fn toggle_button(&mut self) {
        self.selected_button = if self.selected_button == 0 { 1 } else { 0 };
    }

    /// Check if the download button is selected.
    pub fn is_download_selected(&self) -> bool {
        self.selected_button == 0
    }
}

/// Events related to onboarding.
#[derive(Debug, Clone)]
pub enum OnboardEvent {
    /// Image check started
    CheckingImage { image_name: String },
    /// Image already exists locally
    ImageExists,
    /// Image not found, need to download
    ImageNotFound { size: Option<u64> },
    /// Download progress update
    DownloadProgress {
        progress: f32,
        status: String,
        layers_downloaded: usize,
        layers_total: usize,
    },
    /// Download completed
    DownloadComplete,
    /// User cancelled download
    DownloadCancelled,
    /// An error occurred
    Error { message: String },
}

/// Check if a Docker image exists locally.
pub async fn check_image_exists(image_name: &str) -> bool {
    let output = Command::new("docker")
        .args(["images", "-q", image_name])
        .output()
        .await;

    match output {
        Ok(output) => !output.stdout.is_empty(),
        Err(_) => false,
    }
}

/// Query the size of a Docker image from the registry.
/// Returns size_in_bytes if available.
pub async fn query_image_size(image_name: &str) -> Option<u64> {
    // For local-only images (no registry prefix like ghcr.io/), skip size query
    if !image_name.contains('/') || image_name.starts_with("localhost") {
        return None;
    }

    // Try GHCR API first for ghcr.io images (works with anonymous access)
    if image_name.starts_with("ghcr.io/") {
        if let Some(size) = query_size_from_ghcr(image_name).await {
            return Some(size);
        }
    }

    // Try using `crane` first (if available) - it handles auth better
    if let Some(size) = query_size_with_crane(image_name).await {
        return Some(size);
    }

    // Try docker manifest inspect (requires docker login for private registries)
    if let Some(size) = query_size_with_docker_manifest(image_name).await {
        return Some(size);
    }

    None
}

/// Query image size from GHCR using anonymous token-based access.
/// GHCR requires token auth even for public images.
async fn query_size_from_ghcr(image_name: &str) -> Option<u64> {
    // Parse image name: ghcr.io/org/repo:tag -> org/repo, tag
    let without_registry = image_name.strip_prefix("ghcr.io/")?;
    let (repo, tag) = if let Some(at_pos) = without_registry.rfind(':') {
        (&without_registry[..at_pos], &without_registry[at_pos + 1..])
    } else {
        (without_registry, "latest")
    };

    // Get anonymous token
    let token_url = format!("https://ghcr.io/token?scope=repository:{}:pull", repo);

    let token_output = Command::new("curl")
        .args(["-s", &token_url])
        .output()
        .await
        .ok()?;

    if !token_output.status.success() {
        return None;
    }

    let token_json: serde_json::Value = serde_json::from_slice(&token_output.stdout).ok()?;
    let token = token_json.get("token")?.as_str()?;

    // Fetch manifest index
    let manifest_url = format!("https://ghcr.io/v2/{}/manifests/{}", repo, tag);

    let manifest_output = Command::new("curl")
        .args([
            "-s",
            "-H",
            &format!("Authorization: Bearer {}", token),
            "-H",
            "Accept: application/vnd.oci.image.index.v1+json",
            &manifest_url,
        ])
        .output()
        .await
        .ok()?;

    if !manifest_output.status.success() {
        return None;
    }

    let manifest_json: serde_json::Value = serde_json::from_slice(&manifest_output.stdout).ok()?;

    // Find the manifest for current architecture
    let arch = std::env::consts::ARCH;
    let target_arch = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => arch,
    };

    let manifests = manifest_json.get("manifests")?.as_array()?;
    let mut platform_digest: Option<&str> = None;

    for manifest in manifests {
        let manifest_arch = manifest
            .get("platform")
            .and_then(|p| p.get("architecture"))
            .and_then(|a| a.as_str())
            .unwrap_or("");

        if manifest_arch == target_arch {
            platform_digest = manifest.get("digest").and_then(|d| d.as_str());
            break;
        }
    }

    let digest = platform_digest?;

    // Fetch platform-specific manifest to get layer sizes
    let platform_manifest_url = format!("https://ghcr.io/v2/{}/manifests/{}", repo, digest);

    let platform_output = Command::new("curl")
        .args([
            "-s",
            "-H",
            &format!("Authorization: Bearer {}", token),
            "-H",
            "Accept: application/vnd.oci.image.manifest.v1+json",
            &platform_manifest_url,
        ])
        .output()
        .await
        .ok()?;

    if !platform_output.status.success() {
        return None;
    }

    let platform_json: serde_json::Value = serde_json::from_slice(&platform_output.stdout).ok()?;

    // Sum up layer sizes
    let mut total_size: u64 = 0;

    if let Some(layers) = platform_json.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if let Some(size) = layer.get("size").and_then(|s| s.as_u64()) {
                total_size += size;
            }
        }
    }

    if let Some(config_size) = platform_json
        .get("config")
        .and_then(|c| c.get("size"))
        .and_then(|s| s.as_u64())
    {
        total_size += config_size;
    }

    if total_size > 0 {
        Some(total_size)
    } else {
        None
    }
}

/// Try to get image size using crane (from go-containerregistry)
async fn query_size_with_crane(image_name: &str) -> Option<u64> {
    let output = Command::new("crane")
        .args(["manifest", image_name])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;

    // Sum up layer sizes from the manifest
    let mut total_size: u64 = 0;

    // Handle manifest list (multi-arch)
    if let Some(manifests) = json.get("manifests").and_then(|m| m.as_array()) {
        // For manifest lists, get the first matching architecture
        let arch = std::env::consts::ARCH;
        let target_arch = match arch {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            _ => arch,
        };

        for manifest in manifests {
            let manifest_arch = manifest
                .get("platform")
                .and_then(|p| p.get("architecture"))
                .and_then(|a| a.as_str())
                .unwrap_or("");

            if manifest_arch == target_arch {
                if let Some(size) = manifest.get("size").and_then(|s| s.as_u64()) {
                    return Some(size);
                }
            }
        }
    }

    // Handle regular manifest
    if let Some(layers) = json.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if let Some(size) = layer.get("size").and_then(|s| s.as_u64()) {
                total_size += size;
            }
        }
    }

    if let Some(config_size) = json
        .get("config")
        .and_then(|c| c.get("size"))
        .and_then(|s| s.as_u64())
    {
        total_size += config_size;
    }

    if total_size > 0 {
        Some(total_size)
    } else {
        None
    }
}

/// Try to get image size using docker manifest inspect
async fn query_size_with_docker_manifest(image_name: &str) -> Option<u64> {
    let output = Command::new("docker")
        .args(["manifest", "inspect", image_name, "--verbose"])
        .env("DOCKER_CLI_EXPERIMENTAL", "enabled")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse JSON to extract sizes
    let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;

    let mut total_size: u64 = 0;

    // Handle both array (multi-arch) and single manifest
    let manifests = if json.is_array() {
        json.as_array()?.clone()
    } else {
        vec![json]
    };

    // Find the manifest for our architecture
    let arch = std::env::consts::ARCH;
    let target_arch = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => arch,
    };

    for manifest in manifests {
        let platform = manifest.get("Descriptor").and_then(|d| d.get("platform"));
        let manifest_arch = platform
            .and_then(|p| p.get("architecture"))
            .and_then(|a| a.as_str())
            .unwrap_or("");

        if !manifest_arch.is_empty() && manifest_arch != target_arch {
            continue;
        }

        if let Some(layers) = manifest
            .get("SchemaV2Manifest")
            .and_then(|m| m.get("layers"))
            .and_then(|l| l.as_array())
        {
            for layer in layers {
                if let Some(size) = layer.get("size").and_then(|s| s.as_u64()) {
                    total_size += size;
                }
            }
        }

        if let Some(config_size) = manifest
            .get("SchemaV2Manifest")
            .and_then(|m| m.get("config"))
            .and_then(|c| c.get("size"))
            .and_then(|s| s.as_u64())
        {
            total_size += config_size;
        }

        if total_size > 0 {
            break;
        }
    }

    if total_size > 0 {
        Some(total_size)
    } else {
        None
    }
}

/// Pull a Docker image and send progress updates.
pub async fn pull_image_with_progress(
    image_name: String,
    event_tx: mpsc::UnboundedSender<OnboardEvent>,
) {
    let mut child = match Command::new("docker")
        .args(["pull", &image_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            let _ = event_tx.send(OnboardEvent::Error {
                message: format!("Failed to start docker pull: {}", e),
            });
            return;
        }
    };

    // Read stderr for progress (docker pull writes progress to stderr)
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        let mut reader = BufReader::new(stderr).lines();
        let mut layers_total = 0;
        let mut layers_complete = 0;

        while let Ok(Some(line)) = reader.next_line().await {
            // Parse docker pull output lines like:
            // "abc123: Pulling fs layer"
            // "abc123: Downloading [=>       ] 1.2MB/10MB"
            // "abc123: Pull complete"
            // "Digest: sha256:..."
            // "Status: Downloaded newer image..."

            if line.contains("Pulling fs layer") {
                layers_total += 1;
            } else if line.contains("Pull complete") || line.contains("Already exists") {
                layers_complete += 1;
            }

            let progress = if layers_total > 0 {
                layers_complete as f32 / layers_total as f32
            } else {
                0.0
            };

            // Extract a clean status message
            let status = if line.contains("Downloading") {
                // Extract the size info from "Downloading [=> ] 1.2MB/10MB"
                if let Some(start) = line.find(']') {
                    line[start + 1..].trim().to_string()
                } else {
                    "Downloading...".to_string()
                }
            } else if line.contains("Extracting") {
                "Extracting layers...".to_string()
            } else if line.contains("Digest:") {
                "Verifying...".to_string()
            } else if line.contains("Status:") {
                line.replace("Status: ", "")
            } else {
                "Pulling image...".to_string()
            };

            let _ = event_tx.send(OnboardEvent::DownloadProgress {
                progress,
                status,
                layers_downloaded: layers_complete,
                layers_total,
            });
        }
    }

    // Wait for the process to complete
    match child.wait().await {
        Ok(status) if status.success() => {
            let _ = event_tx.send(OnboardEvent::DownloadComplete);
        }
        Ok(status) => {
            let _ = event_tx.send(OnboardEvent::Error {
                message: format!("Docker pull failed with exit code: {}", status),
            });
        }
        Err(e) => {
            let _ = event_tx.send(OnboardEvent::Error {
                message: format!("Failed to wait for docker pull: {}", e),
            });
        }
    }
}

/// Run the full onboarding check.
pub async fn run_onboard_check(image_name: String, event_tx: mpsc::UnboundedSender<OnboardEvent>) {
    // First check if image exists
    let _ = event_tx.send(OnboardEvent::CheckingImage {
        image_name: image_name.clone(),
    });

    if check_image_exists(&image_name).await {
        let _ = event_tx.send(OnboardEvent::ImageExists);
        return;
    }

    // Image doesn't exist, query size from registry
    let size = query_image_size(&image_name).await;

    let _ = event_tx.send(OnboardEvent::ImageNotFound { size });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_size() {
        let state = OnboardState {
            image_size: Some(1_500_000_000),
            ..Default::default()
        };
        assert_eq!(state.format_size(), "1.5 GB");

        let state = OnboardState {
            image_size: Some(250_000_000),
            ..Default::default()
        };
        assert_eq!(state.format_size(), "250.0 MB");

        let state = OnboardState {
            image_size: Some(1_500_000),
            ..Default::default()
        };
        assert_eq!(state.format_size(), "1.5 MB");

        let state = OnboardState {
            image_size: Some(1_500),
            ..Default::default()
        };
        assert_eq!(state.format_size(), "1.5 KB");

        let state = OnboardState {
            image_size: Some(500),
            ..Default::default()
        };
        assert_eq!(state.format_size(), "500 bytes");

        let state = OnboardState::default();
        assert_eq!(state.format_size(), "Unknown size");
    }

    #[test]
    fn test_toggle_button() {
        let mut state = OnboardState::default();
        assert_eq!(state.selected_button, 0);
        assert!(state.is_download_selected());

        state.toggle_button();
        assert_eq!(state.selected_button, 1);
        assert!(!state.is_download_selected());

        state.toggle_button();
        assert_eq!(state.selected_button, 0);
        assert!(state.is_download_selected());
    }
}
