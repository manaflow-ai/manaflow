/**
 * Unit tests for build-commands module.
 *
 * Tests the BuildCommand abstraction and conversion functions.
 */

import { describe, it, expect } from "vitest";
import {
  getProvisioningCommands,
  generateBootScript,
  generateSystemdUnit,
  commandsToDockerfile,
  commandsToShellScript,
  type BuildCommand,
} from "./build-commands";

describe("getProvisioningCommands", () => {
  it("should return an array of build commands", () => {
    const commands = getProvisioningCommands();

    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(0);
  });

  it("should include required command types", () => {
    const commands = getProvisioningCommands();

    const types = new Set(commands.map((c) => c.type));
    expect(types.has("run")).toBe(true);
    expect(types.has("env")).toBe(true);
  });

  it("should include apt-get update as first run command", () => {
    const commands = getProvisioningCommands();

    const firstRun = commands.find((c) => c.type === "run");
    expect(firstRun?.args[0]).toContain("apt-get update");
  });

  it("should include Node.js installation", () => {
    const commands = getProvisioningCommands();

    const nodeSetup = commands.find((c) =>
      c.args.some((arg) => arg.includes("nodesource"))
    );
    expect(nodeSetup).toBeDefined();
  });

  it("should include Rust installation", () => {
    const commands = getProvisioningCommands();

    const rustInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("rustup.rs"))
    );
    expect(rustInstall).toBeDefined();
  });

  it("should include Bun installation", () => {
    const commands = getProvisioningCommands();

    const bunInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("bun.sh/install"))
    );
    expect(bunInstall).toBeDefined();
  });

  it("should include ACP CLI tools", () => {
    const commands = getProvisioningCommands();

    const acpInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("claude-code-acp"))
    );
    expect(acpInstall).toBeDefined();
  });

  it("should include agent-browser install", () => {
    const commands = getProvisioningCommands();

    const agentBrowserInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("agent-browser"))
    );
    expect(agentBrowserInstall).toBeDefined();
  });

  it("should wrap agent-browser to use CDP Chrome by default", () => {
    const commands = getProvisioningCommands();

    const agentBrowserWrapper = commands.find(
      (c) =>
        c.type === "run" &&
        c.args.some(
          (arg) =>
            arg.includes("agent-browser-real") &&
            arg.includes("--cdp") &&
            arg.includes("AGENT_BROWSER_CDP_PORT")
        )
    );
    expect(agentBrowserWrapper).toBeDefined();
  });

  it("should include cmux-code install", () => {
    const commands = getProvisioningCommands();

    const cmuxCodeInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("vscode-1/releases"))
    );
    expect(cmuxCodeInstall).toBeDefined();
  });

  it("should include Chrome install", () => {
    const commands = getProvisioningCommands();

    const chromeInstall = commands.find((c) =>
      c.args.some((arg) => arg.includes("google-chrome-stable"))
    );
    expect(chromeInstall).toBeDefined();
  });

  it("should include directory creation", () => {
    const commands = getProvisioningCommands();

    const mkdirCmd = commands.find((c) =>
      c.args.some((arg) => arg.includes("/etc/cmux"))
    );
    expect(mkdirCmd).toBeDefined();
  });

  it("should include MCP upload tool install", () => {
    const commands = getProvisioningCommands();

    const mcpCopy = commands.find(
      (c) =>
        c.type === "run" &&
        c.args.some((arg) => arg.includes("/usr/local/bin/mcp-upload"))
    );
    expect(mcpCopy).toBeDefined();
  });

  it("should include Chrome launcher install", () => {
    const commands = getProvisioningCommands();

    const chromeLauncher = commands.find(
      (c) =>
        c.type === "run" &&
        c.args.some((arg) => arg.includes("/usr/local/bin/cmux-start-chrome"))
    );
    expect(chromeLauncher).toBeDefined();
  });

  it("should include agent-browser skill install", () => {
    const commands = getProvisioningCommands();

    const skillInstall = commands.find(
      (c) =>
        c.type === "run" &&
        c.args.some((arg) => arg.includes("skills/agent-browser"))
    );
    expect(skillInstall).toBeDefined();
  });

  it("should have descriptions for most commands", () => {
    const commands = getProvisioningCommands();

    const withDescriptions = commands.filter((c) => c.description);
    // At least half should have descriptions
    expect(withDescriptions.length).toBeGreaterThan(commands.length / 2);
  });
});

describe("generateBootScript", () => {
  it("should return a valid bash script", () => {
    const script = generateBootScript();

    expect(script.startsWith("#!/bin/bash")).toBe(true);
    expect(script).toContain("set -e");
  });

  it("should include PATH setup", () => {
    const script = generateBootScript();

    expect(script).toContain("/root/.bun/bin");
    expect(script).toContain("/root/.cargo/bin");
  });

  it("should start cmux-acp-server", () => {
    const script = generateBootScript();

    expect(script).toContain("cmux-acp-server");
  });

  it("should start VNC and Chrome", () => {
    const script = generateBootScript();

    expect(script).toContain("vncserver");
    expect(script).toContain("cmux-start-chrome");
  });

  it("should start cmux-code", () => {
    const script = generateBootScript();

    expect(script).toContain("cmux-code");
    expect(script).toContain("code-server-oss");
  });

  it("should include health check loop", () => {
    const script = generateBootScript();

    expect(script).toContain("localhost:39384/health");
    expect(script).toContain("for i in");
  });
});

describe("generateSystemdUnit", () => {
  it("should return a valid systemd unit file", () => {
    const unit = generateSystemdUnit();

    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
  });

  it("should include ExecStart for cmux-acp-server", () => {
    const unit = generateSystemdUnit();

    expect(unit).toContain("ExecStart=/usr/local/bin/cmux-acp-server");
  });

  it("should include PATH with bun and cargo", () => {
    const unit = generateSystemdUnit();

    expect(unit).toContain("/root/.bun/bin");
    expect(unit).toContain("/root/.cargo/bin");
  });

  it("should enable restart on failure", () => {
    const unit = generateSystemdUnit();

    expect(unit).toContain("Restart=always");
  });
});

describe("commandsToDockerfile", () => {
  it("should start with FROM instruction", () => {
    const commands: BuildCommand[] = [
      { type: "run", args: ["echo hello"] },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile.startsWith("FROM debian:bookworm")).toBe(true);
  });

  it("should use custom base image when provided", () => {
    const commands: BuildCommand[] = [];

    const dockerfile = commandsToDockerfile(commands, {
      baseImage: "ubuntu:22.04",
    });

    expect(dockerfile).toContain("FROM ubuntu:22.04");
  });

  it("should convert run commands to RUN instructions", () => {
    const commands: BuildCommand[] = [
      { type: "run", args: ["apt-get update"] },
      { type: "run", args: ["apt-get install -y curl"] },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile).toContain("RUN apt-get update");
    expect(dockerfile).toContain("RUN apt-get install -y curl");
  });

  it("should convert copy commands to COPY instructions", () => {
    const commands: BuildCommand[] = [
      { type: "copy", args: ["./local/file.txt", "/remote/file.txt"] },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile).toContain("COPY ./local/file.txt /remote/file.txt");
  });

  it("should convert env commands to ENV instructions", () => {
    const commands: BuildCommand[] = [
      { type: "env", args: ["PATH", "/usr/local/bin:$PATH"] },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile).toContain('ENV PATH="/usr/local/bin:$PATH"');
  });

  it("should convert workdir commands to WORKDIR instructions", () => {
    const commands: BuildCommand[] = [
      { type: "workdir", args: ["/app"] },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile).toContain("WORKDIR /app");
  });

  it("should add ENTRYPOINT instruction", () => {
    const commands: BuildCommand[] = [];

    const dockerfile = commandsToDockerfile(commands, {
      entrypoint: ["/bin/sh", "-c", "echo hello"],
    });

    expect(dockerfile).toContain('ENTRYPOINT ["/bin/sh","-c","echo hello"]');
  });

  it("should include preamble lines", () => {
    const commands: BuildCommand[] = [];

    const dockerfile = commandsToDockerfile(commands, {
      preamble: ["# Custom preamble", "LABEL maintainer=test"],
    });

    expect(dockerfile).toContain("# Custom preamble");
    expect(dockerfile).toContain("LABEL maintainer=test");
  });

  it("should add comments for commands with descriptions", () => {
    const commands: BuildCommand[] = [
      {
        type: "run",
        args: ["apt-get update"],
        description: "Update package list",
      },
    ];

    const dockerfile = commandsToDockerfile(commands);

    expect(dockerfile).toContain("# Update package list");
  });

  it("should generate valid Dockerfile from provisioning commands", () => {
    const commands = getProvisioningCommands();
    const dockerfile = commandsToDockerfile(commands);

    // Should have FROM
    expect(dockerfile).toContain("FROM");

    // Should have multiple RUN instructions
    const runCount = (dockerfile.match(/^RUN /gm) || []).length;
    expect(runCount).toBeGreaterThan(5);

    // Should have ENV instructions
    expect(dockerfile).toContain("ENV");

    // Should end with ENTRYPOINT
    expect(dockerfile).toContain("ENTRYPOINT");
  });
});

describe("commandsToShellScript", () => {
  it("should start with shebang", () => {
    const commands: BuildCommand[] = [];

    const script = commandsToShellScript(commands);

    expect(script.startsWith("#!/bin/bash")).toBe(true);
  });

  it("should include set -e for error handling", () => {
    const commands: BuildCommand[] = [];

    const script = commandsToShellScript(commands);

    expect(script).toContain("set -e");
  });

  it("should convert run commands to shell commands", () => {
    const commands: BuildCommand[] = [
      { type: "run", args: ["apt-get update"] },
    ];

    const script = commandsToShellScript(commands);

    expect(script).toContain("apt-get update");
  });

  it("should convert env commands to export statements", () => {
    const commands: BuildCommand[] = [
      { type: "env", args: ["MY_VAR", "my_value"] },
    ];

    const script = commandsToShellScript(commands);

    expect(script).toContain('export MY_VAR="my_value"');
  });

  it("should convert workdir commands to cd statements", () => {
    const commands: BuildCommand[] = [
      { type: "workdir", args: ["/app"] },
    ];

    const script = commandsToShellScript(commands);

    expect(script).toContain("cd /app");
  });

  it("should add comments for copy commands", () => {
    const commands: BuildCommand[] = [
      { type: "copy", args: ["./source", "/dest"] },
    ];

    const script = commandsToShellScript(commands);

    expect(script).toContain("# COPY");
  });

  it("should add description comments", () => {
    const commands: BuildCommand[] = [
      {
        type: "run",
        args: ["echo hello"],
        description: "Say hello",
      },
    ];

    const script = commandsToShellScript(commands);

    expect(script).toContain("# Say hello");
  });
});
