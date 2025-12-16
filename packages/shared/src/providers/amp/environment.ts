import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  DEFAULT_AMP_PROXY_PORT,
  DEFAULT_AMP_PROXY_URL,
} from "./constants";

export async function getAmpEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  // Ensure .config/amp and .local/share/amp directories exist
  startupCommands.push("mkdir -p ~/.config/amp");
  startupCommands.push("mkdir -p ~/.local/share/amp");

  // Transfer settings.json
  try {
    const settingsPath = `${homedir()}/.config/amp/settings.json`;
    const settingsContent = await readFile(settingsPath, "utf-8");

    // Validate that it's valid JSON
    JSON.parse(settingsContent);

    files.push({
      destinationPath: "$HOME/.config/amp/settings.json",
      contentBase64: Buffer.from(settingsContent).toString("base64"),
      mode: "644",
    });
  } catch (error) {
    console.warn("Failed to read amp settings.json:", error);
    // Create default settings if none exist
    const defaultSettings = {
      model: "anthropic/claude-3-5-sonnet-20241022",
      theme: "dark",
    };
    files.push({
      destinationPath: "$HOME/.config/amp/settings.json",
      contentBase64: Buffer.from(
        JSON.stringify(defaultSettings, null, 2)
      ).toString("base64"),
      mode: "644",
    });
  }

  // Transfer secrets.json
  try {
    const secretsPath = `${homedir()}/.local/share/amp/secrets.json`;
    const secretsContent = await readFile(secretsPath, "utf-8");

    // Validate that it's valid JSON
    JSON.parse(secretsContent);

    files.push({
      destinationPath: "$HOME/.local/share/amp/secrets.json",
      contentBase64: Buffer.from(secretsContent).toString("base64"),
      mode: "600", // More restrictive permissions for secrets
    });
  } catch (error) {
    console.warn("Failed to read amp secrets.json:", error);
  }

  // The local proxy that Amp CLI should talk to
  env.AMP_PROXY_PORT = String(DEFAULT_AMP_PROXY_PORT);
  env.AMP_URL = DEFAULT_AMP_PROXY_URL;
  // Upstream URL that the proxy should target (avoid loop with AMP_URL)
  env.AMP_UPSTREAM_URL = "https://ampcode.com";

  // Use the taskRunId directly so the AMP proxy can extract it.
  // Prefix with taskRunId: to be explicit, though the proxy accepts bare IDs too.
  env.AMP_API_KEY = `taskRunId:${ctx.taskRunId}`;

  return { files, env, startupCommands };
}
