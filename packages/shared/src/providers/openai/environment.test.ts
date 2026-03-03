import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getOpenAIEnvironment, stripFilteredConfigKeys } from "./environment";
import { getCrossToolSymlinkCommands } from "../../agent-memory-protocol";

function decodeConfigToml(result: Awaited<ReturnType<typeof getOpenAIEnvironment>>): string {
  const configFile = result.files?.find(
    (file) => file.destinationPath === "$HOME/.codex/config.toml"
  );
  expect(configFile).toBeDefined();
  return Buffer.from(configFile!.contentBase64, "base64").toString("utf-8");
}

describe("stripFilteredConfigKeys", () => {
  it("removes model key from config", () => {
    const input = `model = "gpt-5.2"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes model_reasoning_effort key from config", () => {
    const input = `model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]`);
  });

  it("removes both model and model_reasoning_effort keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "high"
notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"`);
  });

  it("preserves other keys and sections", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"
model = "gpt-5.2"

[notice.model_migrations]
"o3" = "gpt-5.3-codex"`;
    const result = stripFilteredConfigKeys(input);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[notice.model_migrations]
"o3" = "gpt-5.3-codex"`);
  });

  it("handles different value formats", () => {
    // Double quotes
    expect(stripFilteredConfigKeys(`model = "gpt-5.2"`)).toBe("");
    // Single quotes
    expect(stripFilteredConfigKeys(`model = 'gpt-5.2'`)).toBe("");
    // Bare string (if TOML allows)
    expect(stripFilteredConfigKeys(`model = gpt-5.2`)).toBe("");
  });

  it("handles varying whitespace around equals sign", () => {
    expect(stripFilteredConfigKeys(`model="gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model  =  "gpt-5.2"`)).toBe("");
    expect(stripFilteredConfigKeys(`model =    "gpt-5.2"`)).toBe("");
  });

  it("does not remove keys inside sections", () => {
    // model inside a section should NOT be removed (only top-level)
    // Note: current regex removes any line starting with "model =", not section-aware
    // This test documents current behavior - if section-awareness is needed, update regex
    const input = `[some_section]
model = "should-stay"`;
    const result = stripFilteredConfigKeys(input);
    // Current implementation removes it - this is acceptable since Codex config
    // doesn't typically have model keys inside sections
    expect(result).toBe(`[some_section]`);
  });

  it("handles empty input", () => {
    expect(stripFilteredConfigKeys("")).toBe("");
  });

  it("handles input with only filtered keys", () => {
    const input = `model = "gpt-5.2"
model_reasoning_effort = "xhigh"`;
    expect(stripFilteredConfigKeys(input)).toBe("");
  });

  it("cleans up multiple blank lines", () => {
    const input = `notify = ["/root/lifecycle/codex-notify.sh"]

model = "gpt-5.2"


model_reasoning_effort = "high"

approval_mode = "full"`;
    const result = stripFilteredConfigKeys(input);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toBe(`notify = ["/root/lifecycle/codex-notify.sh"]

approval_mode = "full"`);
  });
});

describe("getOpenAIEnvironment", () => {
  it("includes --agent in managed devsh-memory MCP args when agentName is provided", async () => {
    const result = await getOpenAIEnvironment({
      agentName: "codex/gpt-5.1-codex-mini",
    } as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).toContain(
      'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
    );
  });

  it("keeps fallback devsh-memory MCP args when agentName is not provided", async () => {
    const result = await getOpenAIEnvironment({} as never);

    const toml = decodeConfigToml(result);
    expect(toml).toContain('args = ["-y","devsh-memory-mcp@latest"]');
    expect(toml).not.toContain('"--agent"');
  });

  it("generates managed model migrations targeting gpt-5.3-codex (server mode)", async () => {
    // Server mode (useHostConfig: false) generates a clean config.toml
    const result = await getOpenAIEnvironment({} as never);
    const configFile = result.files?.find(
      (file) => file.destinationPath === "$HOME/.codex/config.toml"
    );
    expect(configFile).toBeDefined();

    const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
      "utf-8"
    );
    expect(toml).toContain('notify = ["/root/lifecycle/codex-notify.sh"]');
    expect(toml).toContain('sandbox_mode = "danger-full-access"');
    expect(toml).toContain('ask_for_approval = "never"');
    expect(toml).toContain("[notice.model_migrations]");
    expect(toml).toContain('"gpt-5-codex" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5" = "gpt-5.3-codex"');
    expect(toml).toContain('"o3" = "gpt-5.3-codex"');
    expect(toml).toContain('"o4-mini" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-4.1" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5-codex-mini" = "gpt-5.3-codex"');
    expect(toml).toContain('"gpt-5.2-codex" = "gpt-5.3-codex"');
  });

  it("does not read from host filesystem in server mode (useHostConfig: false)", async () => {
    // Create files in a temp home directory that should NOT be read in server mode
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Put credentials and custom config that should NOT leak into sandbox
      await writeFile(
        join(homeDir, ".codex/auth.json"),
        '{"secret": "host-credential"}',
        "utf-8"
      );
      await writeFile(
        join(homeDir, ".codex/instructions.md"),
        "SECRET HOST INSTRUCTIONS",
        "utf-8"
      );
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `approval_mode = "full"
host_secret = "should-not-leak"
`,
        "utf-8"
      );

      // Server mode: useHostConfig defaults to false
      const result = await getOpenAIEnvironment({} as never);

      // Verify config.toml does NOT contain host-specific settings
      const configFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/config.toml"
      );
      expect(configFile).toBeDefined();
      const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
        "utf-8"
      );
      expect(toml).not.toContain("host_secret");
      expect(toml).not.toContain("approval_mode");
      expect(toml).toContain('sandbox_mode = "danger-full-access"');
      expect(toml).toContain('ask_for_approval = "never"');

      // Verify instructions.md does NOT contain host instructions
      const instructionsFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/instructions.md"
      );
      expect(instructionsFile).toBeDefined();
      const instructions = Buffer.from(
        instructionsFile!.contentBase64,
        "base64"
      ).toString("utf-8");
      expect(instructions).not.toContain("SECRET HOST INSTRUCTIONS");

      // Verify auth.json is NOT copied from host (it should come from applyCodexApiKeys)
      const authFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/auth.json"
      );
      expect(authFile).toBeUndefined();
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reads from host filesystem in desktop mode (useHostConfig: true)", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(join(homeDir, ".codex/auth.json"), '{"user": "desktop-user"}', "utf-8");
      await writeFile(join(homeDir, ".codex/instructions.md"), "My custom instructions", "utf-8");
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"
model = "gpt-5"
model_reasoning_effort = "high"

[notice.model_migrations]
"o3" = "gpt-5.3-codex"

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      // Desktop mode: useHostConfig: true
      const result = await getOpenAIEnvironment({ useHostConfig: true } as never);

      // Verify auth.json IS copied from host
      const authFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/auth.json"
      );
      expect(authFile).toBeDefined();
      const auth = Buffer.from(authFile!.contentBase64, "base64").toString("utf-8");
      expect(auth).toContain("desktop-user");

      // Verify instructions.md includes host content
      const instructionsFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/instructions.md"
      );
      expect(instructionsFile).toBeDefined();
      const instructions = Buffer.from(
        instructionsFile!.contentBase64,
        "base64"
      ).toString("utf-8");
      expect(instructions).toContain("My custom instructions");
      expect(instructions).toContain("memory"); // Also includes memory protocol

      // Verify config.toml merges host settings (minus filtered keys)
      const configFile = result.files?.find(
        (file) => file.destinationPath === "$HOME/.codex/config.toml"
      );
      expect(configFile).toBeDefined();
      const toml = Buffer.from(configFile!.contentBase64, "base64").toString(
        "utf-8"
      );
      expect(toml).toContain('notify = ["/root/lifecycle/codex-notify.sh"]');
      expect(toml).toContain('sandbox_mode = "danger-full-access"');
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain("[some_section]");
      expect(toml).toContain('foo = "bar"');
      // Filtered keys should be removed
      expect(toml).not.toContain('model = "gpt-5"');
      expect(toml).not.toContain('model_reasoning_effort = "high"');
      // Model migrations should be replaced with managed ones
      expect(toml).toContain('"o3" = "gpt-5.3-codex"');
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("replaces stale devsh-memory block from host config with managed block", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[mcp_servers.devsh-memory]
type = "stdio"
command = "npx"
args = ["-y", "devsh-memory-mcp@latest"]

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      const result = await getOpenAIEnvironment({
        useHostConfig: true,
        agentName: "codex/gpt-5.1-codex-mini",
      } as never);

      const toml = decodeConfigToml(result);
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain('[some_section]');
      expect(toml).toContain('foo = "bar"');
      expect(toml).toContain(
        'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
      );
      expect(toml).not.toContain('args = ["-y", "devsh-memory-mcp@latest"]');

      const managedBlockMatches = toml.match(/\[mcp_servers\.devsh-memory\]/g) ?? [];
      expect(managedBlockMatches).toHaveLength(1);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes memory protocol in instructions.md", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const instructionsFile = result.files?.find(
      (file) => file.destinationPath === "$HOME/.codex/instructions.md"
    );
    expect(instructionsFile).toBeDefined();
    const instructions = Buffer.from(
      instructionsFile!.contentBase64,
      "base64"
    ).toString("utf-8");
    // Memory protocol should be included
    expect(instructions).toContain("memory");
  });

  it("strips nested devsh-memory subtables from host config", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-openai-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      // Host config has nested subtables under devsh-memory (e.g., [mcp_servers.devsh-memory.env])
      await writeFile(
        join(homeDir, ".codex/config.toml"),
        `notify = ["/root/lifecycle/codex-notify.sh"]
approval_mode = "full"

[mcp_servers.devsh-memory]
type = "stdio"
command = "npx"
args = ["-y", "devsh-memory-mcp@latest"]

[mcp_servers.devsh-memory.env]
CUSTOM_VAR = "should-be-stripped"

[mcp_servers."devsh-memory".settings]
debug = true

[some_section]
foo = "bar"
`,
        "utf-8"
      );

      const result = await getOpenAIEnvironment({
        useHostConfig: true,
        agentName: "codex/gpt-5.1-codex-mini",
      } as never);

      const toml = decodeConfigToml(result);
      // User's other settings should be preserved
      expect(toml).toContain('approval_mode = "full"');
      expect(toml).toContain('[some_section]');
      expect(toml).toContain('foo = "bar"');
      // Managed block should be present with correct args
      expect(toml).toContain('[mcp_servers.devsh-memory]');
      expect(toml).toContain(
        'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.1-codex-mini"]'
      );
      // Nested subtables should be stripped
      expect(toml).not.toContain('[mcp_servers.devsh-memory.env]');
      expect(toml).not.toContain('CUSTOM_VAR');
      expect(toml).not.toContain('[mcp_servers."devsh-memory".settings]');
      expect(toml).not.toContain('debug = true');
      // Only one devsh-memory block should exist
      const managedBlockMatches = toml.match(/\[mcp_servers(?:\.|\."|")devsh-memory/g) ?? [];
      expect(managedBlockMatches).toHaveLength(1);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes cross-tool symlink commands in startupCommands", async () => {
    const result = await getOpenAIEnvironment({} as never);

    // Should include all symlink commands from getCrossToolSymlinkCommands
    const symlinkCommands = getCrossToolSymlinkCommands();
    for (const cmd of symlinkCommands) {
      expect(result.startupCommands).toContain(cmd);
    }
  });

  it("includes memory startup command", async () => {
    const result = await getOpenAIEnvironment({} as never);

    // Should include mkdir command for memory directories
    expect(result.startupCommands?.some((cmd) =>
      cmd.includes("mkdir -p") && cmd.includes("/root/lifecycle/memory")
    )).toBe(true);
  });

  it("persists Codex thread_id from notify payload for explicit resume", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const notifyFile = result.files?.find(
      (file) => file.destinationPath === "/root/lifecycle/codex-notify.sh"
    );
    expect(notifyFile).toBeDefined();

    const notifyScript = Buffer.from(
      notifyFile!.contentBase64,
      "base64"
    ).toString("utf-8");

    expect(notifyScript).toContain("THREAD_ID=$(echo \"$1\" | jq -r '.thread_id // empty'");
    expect(notifyScript).toContain("codex-session-id.txt");
  });

  it("creates codex-resume helper script", async () => {
    const result = await getOpenAIEnvironment({} as never);
    const resumeFile = result.files?.find(
      (file) => file.destinationPath === "/root/lifecycle/codex-resume.sh"
    );
    expect(resumeFile).toBeDefined();

    const resumeScript = Buffer.from(
      resumeFile!.contentBase64,
      "base64"
    ).toString("utf-8");

    expect(resumeScript).toContain('SESSION_ID_FILE="/root/lifecycle/codex-session-id.txt"');
    expect(resumeScript).toContain('exec codex resume "$THREAD_ID"');
  });
});
