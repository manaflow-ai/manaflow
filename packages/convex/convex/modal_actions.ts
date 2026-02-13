"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import {
  DEFAULT_MODAL_TEMPLATE_ID,
  getModalTemplateByPresetId,
} from "@cmux/shared/modal-templates";
import { DEFAULT_MODAL_SNAPSHOT_ID } from "@cmux/shared/modal-snapshots";
import { ModalClient } from "modal";
import type { Sandbox } from "modal";

/**
 * Create a Modal client using env credentials.
 */
function createClient(): ModalClient {
  return new ModalClient({
    tokenId: env.MODAL_TOKEN_ID,
    tokenSecret: env.MODAL_TOKEN_SECRET,
  });
}

/**
 * Execute a bash command in a sandbox. Returns stdout/stderr/exit_code.
 */
async function execBash(
  sandbox: Sandbox,
  command: string,
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  try {
    const proc = await sandbox.exec(["bash", "-c", command]);
    const stdout = await proc.stdout.readText();
    const stderr = await proc.stderr.readText();
    const exitCode = await proc.wait();
    return { stdout, stderr, exit_code: exitCode ?? 0 };
  } catch (err: unknown) {
    console.error("[modal_actions.execBash] Error:", err);
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exit_code: 1,
    };
  }
}

/**
 * Get tunnel URLs from a sandbox, mapped by port name.
 */
async function getTunnelUrls(sandbox: Sandbox) {
  const tunnels = await sandbox.tunnels();
  const portUrl = (port: number) => tunnels[port]?.url;

  return {
    jupyterUrl: portUrl(8888),
    vscodeUrl: portUrl(39378),
    vncUrl: portUrl(39380),
    workerUrl: portUrl(39377),
  };
}

/**
 * Generate a 64-char hex auth token (same format as E2B worker daemon).
 */
function generateAuthToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * LIGHTWEIGHT startup script — runs on each new instance from a snapshot.
 * Only writes auth token and starts services. No package installation needed.
 */
function buildStartupScript(authToken: string): string {
  return `#!/bin/bash
set -e

# Ensure 'user' account exists (safety net for older snapshots)
id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash -u 1000 user
mkdir -p /home/user/workspace
chown user:user /home/user/workspace

# Write auth token and boot ID so worker-daemon uses our token
echo -n '${authToken}' > /home/user/.worker-auth-token
echo -n '${authToken}' > /home/user/.vscode-token
cat /proc/sys/kernel/random/boot_id | tr -d '\\n' > /home/user/.token-boot-id
chmod 600 /home/user/.worker-auth-token /home/user/.vscode-token /home/user/.token-boot-id

# --- Start TigerVNC ---
nohup Xtigervnc :1 \\
  -geometry 1920x1080 \\
  -depth 24 \\
  -localhost \\
  -SecurityTypes None \\
  -rfbport 5901 \\
  -AlwaysShared \\
  -AcceptSetDesktopSize=1 \\
  > /tmp/tigervnc.log 2>&1 &
sleep 1

# XFCE desktop
export DISPLAY=:1
export HOME=/root
export BROWSER=/usr/bin/google-chrome-stable
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p /tmp/runtime-root
eval \$(dbus-launch --sh-syntax) 2>/dev/null || true
nohup startxfce4 > /tmp/xfce.log 2>&1 &
sleep 2

# Set Chrome as XFCE default browser (must be after startxfce4 creates config)
mkdir -p /root/.config/xfce4
echo 'WebBrowser=google-chrome' > /root/.config/xfce4/helpers.rc
xfconf-query -c xfce4-session -p /compat/LaunchGNOME -s false 2>/dev/null || true

# Chrome (with CDP enabled for cloudrouter computer commands)
mkdir -p /root/.config/chrome
nohup google-chrome \\
  --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer \\
  --no-first-run --no-default-browser-check --disable-session-crashed-bubble \\
  --disable-default-apps --disable-sync --disable-translate --disable-infobars \\
  --disable-features=ChromeWhatsNewUI,AutofillServerCommunication \\
  --start-maximized --window-position=0,0 --window-size=1920,1080 \\
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \\
  --user-data-dir=/root/.config/chrome --password-store=basic \\
  about:blank > /tmp/chrome.log 2>&1 &
sleep 1

# VNC auth proxy on port 39380 is now built into the Go worker daemon

# cmux-code on port 39378
nohup /app/cmux-code/bin/code-server-oss \\
  --host 0.0.0.0 --port 39378 \\
  --connection-token-file /home/user/.worker-auth-token \\
  --disable-workspace-trust --disable-telemetry --telemetry-level off \\
  /home/user/workspace > /tmp/cmux-code.log 2>&1 &

# Worker daemon on port 39377
nohup /usr/local/bin/worker-daemon > /tmp/worker-daemon.log 2>&1 &

# Jupyter Lab on port 8888
nohup jupyter lab \\
  --ip=0.0.0.0 --port=8888 \\
  --ServerApp.token='${authToken}' \\
  --ServerApp.allow_root=True \\
  --ServerApp.root_dir=/home/user/workspace \\
  --no-browser > /tmp/jupyter.log 2>&1 &

# Create agent-browser wrapper that auto-connects to Chrome CDP on first use
cat > /usr/local/bin/ab << 'WRAPPER_EOF'
#!/bin/bash
# Auto-connect to Chrome CDP if not already connected
if [ ! -S "$HOME/.agent-browser/default.sock" ] || ! agent-browser get url >/dev/null 2>&1; then
  mkdir -p "$HOME/.agent-browser"
  agent-browser connect 9222 >/dev/null 2>&1
fi
exec agent-browser "$@"
WRAPPER_EOF
chmod +x /usr/local/bin/ab

echo "STARTUP_COMPLETE"
`;
}

/**
 * Start a new Modal sandbox instance from a pre-built snapshot.
 */
export const startInstance = internalAction({
  args: {
    templateId: v.optional(v.string()),
    gpu: v.optional(v.string()),
    cpu: v.optional(v.number()),
    memoryMiB: v.optional(v.number()),
    ttlSeconds: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
    envs: v.optional(v.record(v.string(), v.string())),
    image: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const client = createClient();

    // Resolve template preset to get GPU/image config
    const presetId = args.templateId ?? DEFAULT_MODAL_TEMPLATE_ID;
    const preset = getModalTemplateByPresetId(presetId);
    const gpu = args.gpu ?? preset?.gpu;
    const snapshotImageId = DEFAULT_MODAL_SNAPSHOT_ID;

    try {
      console.log(`[modal_actions] Starting from snapshot ${snapshotImageId}`);

      const app = await client.apps.fromName("cmux-devbox", {
        createIfMissing: true,
      });
      const image = await client.images.fromId(snapshotImageId);

      const sandbox = await client.sandboxes.create(app, image, {
        gpu,
        cpu: args.cpu,
        memoryMiB: args.memoryMiB,
        timeoutMs: (args.ttlSeconds ?? 60 * 60) * 1000,
        env: args.envs,
        encryptedPorts: [8888, 39377, 39378, 39380],
      });

      const authToken = generateAuthToken();

      console.log("[modal_actions] Running startup script...");
      const result = await execBash(sandbox, buildStartupScript(authToken));
      if (result.exit_code !== 0) {
        console.error("[modal_actions] Startup script failed:", result.stderr);
      }

      if (args.metadata) {
        await sandbox.setTags(args.metadata);
      }

      // Get tunnel URLs
      const { jupyterUrl, vscodeUrl, vncUrl, workerUrl } =
        await getTunnelUrls(sandbox);

      return {
        instanceId: sandbox.sandboxId,
        status: "running",
        gpu: gpu ?? null,
        authToken,
        jupyterUrl: jupyterUrl
          ? `${jupyterUrl}?token=${authToken}`
          : undefined,
        vscodeUrl: vscodeUrl
          ? `${vscodeUrl}?tkn=${authToken}&folder=/home/user/workspace`
          : undefined,
        workerUrl: workerUrl ?? undefined,
        vncUrl: vncUrl
          ? `${vncUrl}/vnc.html?tkn=${authToken}&autoconnect=true&resize=scale&quality=9&compression=0&show_dot=true&reconnect=true&reconnect_delay=1000`
          : undefined,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Get Modal instance status.
 */
export const getInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = createClient();
    try {
      const sandbox = await client.sandboxes.fromId(args.instanceId);
      const isRunning = (await sandbox.poll()) === null;

      const { jupyterUrl, vscodeUrl, vncUrl, workerUrl } =
        await getTunnelUrls(sandbox);

      return {
        instanceId: args.instanceId,
        status: isRunning ? "running" : "stopped",
        jupyterUrl,
        vscodeUrl,
        workerUrl: workerUrl ?? null,
        vncUrl: vncUrl
          ? `${vncUrl}/viewer.html?autoconnect=true&resize=scale`
          : null,
      };
    } catch {
      return {
        instanceId: args.instanceId,
        status: "stopped",
        jupyterUrl: null,
        vscodeUrl: null,
        workerUrl: null,
        vncUrl: null,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Execute a command in a Modal sandbox.
 * Returns result even for non-zero exit codes.
 */
export const execCommand = internalAction({
  args: {
    instanceId: v.string(),
    command: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = createClient();
    try {
      const sandbox = await client.sandboxes.fromId(args.instanceId);
      return await execBash(sandbox, args.command);
    } catch (err) {
      console.error("[modal_actions.execCommand] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Stop (terminate) a Modal sandbox.
 */
export const stopInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = createClient();
    try {
      const sandbox = await client.sandboxes.fromId(args.instanceId);
      await sandbox.terminate();
      return { stopped: true };
    } finally {
      client.close();
    }
  },
});

/**
 * List all running Modal sandboxes.
 */
export const listInstances = internalAction({
  args: {},
  handler: async () => {
    const client = createClient();
    try {
      const sandboxes: Array<{ sandboxId: string; startedAt: string }> = [];
      for await (const sb of client.sandboxes.list()) {
        sandboxes.push({
          sandboxId: sb.sandboxId,
          startedAt: new Date().toISOString(),
        });
      }
      return sandboxes;
    } finally {
      client.close();
    }
  },
});
