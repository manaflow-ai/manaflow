use portable_pty::{Child, CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::path::Path;

pub struct Pty {
    pub pair: PtyPair,
}

impl Pty {
    pub fn open(cols: u16, rows: u16) -> anyhow::Result<Self> {
        let pty_system = NativePtySystem::default();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size)?;
        Ok(Self { pair })
    }

    pub fn spawn_shell(
        &mut self,
        cmd: Option<&str>,
        args: Vec<String>,
    ) -> anyhow::Result<Box<dyn Child + Send>> {
        let (shell, set_shell_env) = match cmd {
            Some(value) => (value.to_string(), false),
            None => (resolve_default_shell(), true),
        };
        let mut builder = CommandBuilder::new(shell.clone());
        if !args.is_empty() {
            builder.args(args.iter().map(|s| s.as_str()));
        }
        // Ensure TERM is set so full-screen apps behave correctly
        builder.env(
            "TERM",
            std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()),
        );
        if set_shell_env {
            builder.env("SHELL", shell);
        }
        let child = self.pair.slave.spawn_command(builder)?;
        Ok(child)
    }
}

pub type PtyReader = Box<dyn Read + Send>;
pub type PtyWriter = Box<dyn Write + Send>;

fn resolve_default_shell() -> String {
    for candidate in ["/bin/zsh", "/usr/bin/zsh"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }

    if let Ok(shell_env) = std::env::var("SHELL") {
        if !shell_env.is_empty() && Path::new(&shell_env).exists() {
            return shell_env;
        }
    }

    for candidate in ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }

    "/bin/sh".to_string()
}
