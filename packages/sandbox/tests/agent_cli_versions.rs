/// Test that all coding agent CLIs are installed and can print their version.
#[test]
#[ignore = "requires sandbox container environment"]
fn test_coding_agent_clis_installed() {
    let agents = [
        ("claude", "--version"),
        ("codex", "--version"),
        ("gemini", "--version"),
        ("opencode", "--version"),
        ("amp", "--version"),
    ];

    for (agent, flag) in agents {
        let output = std::process::Command::new(agent)
            .arg(flag)
            .output()
            .unwrap_or_else(|e| panic!("Failed to execute {}: {}", agent, e));

        assert!(
            output.status.success(),
            "{} {} failed with status {:?}\nstdout: {}\nstderr: {}",
            agent,
            flag,
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        println!(
            "{}: {}",
            agent,
            String::from_utf8_lossy(&output.stdout).trim()
        );
    }
}
