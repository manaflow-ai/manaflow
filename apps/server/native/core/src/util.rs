use anyhow::{anyhow, Result};
use std::process::{Command, Stdio};

pub fn run_git(cwd: &str, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).args(args).stdin(Stdio::null());
    let output = cmd.output()?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(anyhow!("git {:?} failed: {}", args, err))
    }
}
