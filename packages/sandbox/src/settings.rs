//! Persistent settings for the cmux application.
//!
//! Settings are stored in the OS-appropriate config directory:
//! - macOS: `~/Library/Application Support/cmux/settings.json`
//! - Linux: `~/.config/cmux/settings.json`
//! - Windows: `%APPDATA%/cmux/settings.json`

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_NAME: &str = "cmux";
const SETTINGS_FILE: &str = "settings.json";

/// Default editor choice for opening sandboxes via SSH.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorChoice {
    VSCode,
    #[default]
    Cursor,
    Zed,
    Windsurf,
    /// Custom command with `{host}` and `{path}` placeholders.
    /// Example: `nvim --remote-ui ssh://root@{host}{path}`
    #[serde(rename = "custom")]
    Custom(String),
}

impl EditorChoice {
    /// Get the display name for this editor.
    pub fn label(&self) -> &str {
        match self {
            EditorChoice::VSCode => "VS Code",
            EditorChoice::Cursor => "Cursor",
            EditorChoice::Zed => "Zed",
            EditorChoice::Windsurf => "Windsurf",
            EditorChoice::Custom(_) => "Custom",
        }
    }

    /// Execute the editor command for the given sandbox.
    /// Returns Ok(status_message) on success, Err(error_message) on failure.
    pub fn open(&self, ssh_host: &str, remote_path: &str) -> Result<String, String> {
        match self {
            EditorChoice::VSCode => {
                std::process::Command::new("code")
                    .args(["--remote", &format!("ssh-remote+{}", ssh_host), remote_path])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Failed to open VS Code: {}", e))?;
                Ok(format!("Opening VS Code to {}:{}", ssh_host, remote_path))
            }
            EditorChoice::Cursor => {
                std::process::Command::new("cursor")
                    .args(["--remote", &format!("ssh-remote+{}", ssh_host), remote_path])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Failed to open Cursor: {}", e))?;
                Ok(format!("Opening Cursor to {}:{}", ssh_host, remote_path))
            }
            EditorChoice::Zed => {
                // Zed uses: zed ssh://[user@]host[:port]/path
                let ssh_url = format!("ssh://root@{}{}", ssh_host, remote_path);
                std::process::Command::new("zed")
                    .arg(&ssh_url)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Failed to open Zed: {}", e))?;
                Ok(format!("Opening Zed to {}", ssh_url))
            }
            EditorChoice::Windsurf => {
                // Windsurf uses the same CLI as VS Code: windsurf --remote ssh-remote+<host> <path>
                std::process::Command::new("windsurf")
                    .args(["--remote", &format!("ssh-remote+{}", ssh_host), remote_path])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Failed to open Windsurf: {}", e))?;
                Ok(format!("Opening Windsurf to {}:{}", ssh_host, remote_path))
            }
            EditorChoice::Custom(cmd_template) => {
                // Replace {host} and {path} placeholders
                let cmd = cmd_template
                    .replace("{host}", ssh_host)
                    .replace("{path}", remote_path);

                // Parse the command - first word is the binary, rest are args
                let parts: Vec<&str> = cmd.split_whitespace().collect();
                if parts.is_empty() {
                    return Err("Custom editor command is empty".to_string());
                }

                let binary = parts[0];
                let args = &parts[1..];

                std::process::Command::new(binary)
                    .args(args)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("Failed to run custom command '{}': {}", binary, e))?;

                Ok(format!("Running: {}", cmd))
            }
        }
    }

    /// Parse from string (for env var and CLI).
    pub fn from_str_loose(s: &str) -> Self {
        let lower = s.to_lowercase();
        if lower == "vscode" || lower == "code" {
            EditorChoice::VSCode
        } else if lower == "cursor" {
            EditorChoice::Cursor
        } else if lower == "zed" {
            EditorChoice::Zed
        } else if lower == "windsurf" {
            EditorChoice::Windsurf
        } else {
            // Treat as custom command template
            EditorChoice::Custom(s.to_string())
        }
    }
}

/// Persistent settings for the application.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    /// Default editor for opening sandboxes.
    #[serde(default)]
    pub default_editor: EditorChoice,
}

impl Settings {
    /// Get the path to the settings file.
    fn path() -> Option<PathBuf> {
        dirs::config_dir().map(|dir| dir.join(APP_NAME).join(SETTINGS_FILE))
    }

    /// Load settings from disk, falling back to defaults if not found or invalid.
    /// Also checks DMUX_EDITOR env var which takes precedence over saved settings.
    pub fn load() -> Self {
        // First, try loading from file
        let mut settings = Self::load_from_file();

        // Environment variable overrides saved settings
        if let Ok(val) = std::env::var("DMUX_EDITOR") {
            settings.default_editor = EditorChoice::from_str_loose(&val);
        }

        settings
    }

    /// Load settings from file only (no env var override).
    fn load_from_file() -> Self {
        let Some(path) = Self::path() else {
            return Self::default();
        };

        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
                tracing::warn!("Failed to parse settings file: {}", e);
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    /// Save settings to disk.
    pub fn save(&self) -> Result<(), String> {
        let Some(path) = Self::path() else {
            return Err("Could not determine config directory".to_string());
        };

        // Ensure directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let contents = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        fs::write(&path, contents).map_err(|e| format!("Failed to write settings file: {}", e))?;

        tracing::debug!("Saved settings to {:?}", path);
        Ok(())
    }

    /// Get the path where settings are stored (for display to user).
    pub fn settings_path() -> Option<String> {
        Self::path().map(|p| p.to_string_lossy().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_choice_serialization() {
        // Test round-trip serialization
        let choices = vec![
            EditorChoice::VSCode,
            EditorChoice::Cursor,
            EditorChoice::Zed,
            EditorChoice::Windsurf,
            EditorChoice::Custom("nvim --remote {host} {path}".to_string()),
        ];

        for choice in choices {
            let json = serde_json::to_string(&choice).unwrap();
            let parsed: EditorChoice = serde_json::from_str(&json).unwrap();
            assert_eq!(choice, parsed);
        }
    }

    #[test]
    fn settings_serialization() {
        let settings = Settings {
            default_editor: EditorChoice::Zed,
        };

        let json = serde_json::to_string_pretty(&settings).unwrap();
        let parsed: Settings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings.default_editor, parsed.default_editor);
    }

    #[test]
    fn editor_from_str_loose() {
        assert_eq!(EditorChoice::from_str_loose("vscode"), EditorChoice::VSCode);
        assert_eq!(EditorChoice::from_str_loose("code"), EditorChoice::VSCode);
        assert_eq!(EditorChoice::from_str_loose("CURSOR"), EditorChoice::Cursor);
        assert_eq!(EditorChoice::from_str_loose("Zed"), EditorChoice::Zed);
        assert_eq!(
            EditorChoice::from_str_loose("windsurf"),
            EditorChoice::Windsurf
        );
        assert_eq!(
            EditorChoice::from_str_loose("nvim --remote {host}"),
            EditorChoice::Custom("nvim --remote {host}".to_string())
        );
    }
}
