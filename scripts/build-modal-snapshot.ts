#!/usr/bin/env bun
/**
 * Local script to build a Modal snapshot with all deps pre-installed.
 * Reads MODAL_TOKEN_ID and MODAL_TOKEN_SECRET from .env.
 *
 * Usage:
 *   bun scripts/build-modal-snapshot.ts
 */

import { ModalClient } from "modal";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Load .env file into process.env for createEnv
const envPath = resolve(import.meta.dirname!, "../.env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const env = createEnv({
  server: {
    MODAL_TOKEN_ID: z.string().min(1),
    MODAL_TOKEN_SECRET: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

const MODAL_SNAPSHOTS_PATH = resolve(
  import.meta.dirname!,
  "../packages/shared/src/modal-snapshots.json",
);

const CMUX_CODE_VERSION = "0.9.0";

const INSTALL_SCRIPT = `#!/bin/bash
set -e

# Create 'user' account (matches E2B sandbox layout)
id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash -u 1000 user
mkdir -p /home/user/workspace
chown -R user:user /home/user

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq \\
  curl procps jq wget gnupg pip rsync \\
  tigervnc-standalone-server tigervnc-common \\
  xfce4 xfce4-terminal dbus-x11 \\
  novnc python3-websockify \\
  fonts-liberation fonts-dejavu \\
  npm \\
  > /dev/null 2>&1

# Install agent-browser (Vercel's browser automation CLI)
npm install -g agent-browser > /dev/null 2>&1

# Install Google Chrome
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
apt-get install -y -qq /tmp/chrome.deb > /dev/null 2>&1 || apt-get install -y -qq -f > /dev/null 2>&1
rm -f /tmp/chrome.deb

# Install cmux-code (VSCode fork)
mkdir -p /app/cmux-code
curl -fSL --retry 3 --retry-delay 2 -o /tmp/cmux-code.tar.gz \\
  "https://github.com/manaflow-ai/vscode-1/releases/download/v${CMUX_CODE_VERSION}/vscode-server-linux-x64-web.tar.gz"
tar xf /tmp/cmux-code.tar.gz -C /app/cmux-code/ --strip-components=1
rm -f /tmp/cmux-code.tar.gz

# Install worker daemon (Go binary for PTY/SSH)
curl -fSL --retry 3 --retry-delay 2 -o /usr/local/bin/worker-daemon \\
  "https://github.com/manaflow-ai/vscode-1/releases/download/v${CMUX_CODE_VERSION}/worker-daemon"
chmod +x /usr/local/bin/worker-daemon

# Install JupyterLab + data science stack
pip install -q \
  jupyterlab \
  numpy \
  pandas \
  scipy \
  scikit-learn \
  matplotlib \
  seaborn \
  plotly \
  tensorflow \
  transformers \
  datasets \
  accelerate \
  opencv-python-headless \
  Pillow \
  requests \
  httpx \
  beautifulsoup4 \
  lxml \
  sqlalchemy \
  ipywidgets \
  tqdm \
  pyyaml \
  boto3 \
  openai \
  anthropic \
  2>/dev/null || true

# Install PyTorch CPU (separate due to custom index URL)
pip install -q \
  torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/cpu \
  2>/dev/null || true

# Set Google Chrome as the default browser (system-level)
update-alternatives --set x-www-browser /usr/bin/google-chrome-stable 2>/dev/null || true
update-alternatives --set gnome-www-browser /usr/bin/google-chrome-stable 2>/dev/null || true
# Note: XFCE helpers.rc is set in the startup script since startxfce4 recreates config

# Create VNC viewer wrapper that strips auth token from visible URL
cat > /usr/share/novnc/viewer.html << 'VIEWER_EOF'
<!DOCTYPE html>
<html style="margin:0;padding:0;height:100%;overflow:hidden">
<head><meta charset="utf-8"><title>VNC</title></head>
<body style="margin:0;padding:0;height:100%;overflow:hidden">
<iframe id="vnc" style="width:100%;height:100%;border:none"></iframe>
<script>
(function(){
  var params = new URLSearchParams(location.search);
  // Copy tkn to token so noVNC passes it on WebSocket connections
  if (params.has('tkn') && !params.has('token')) {
    params.set('token', params.get('tkn'));
  }
  document.getElementById('vnc').src = 'vnc.html?' + params.toString();
  // Strip secrets from visible URL
  params.delete('tkn');
  params.delete('token');
  var clean = location.pathname + (params.toString() ? '?' + params.toString() : '');
  history.replaceState(null, '', clean);
})();
</script>
</body>
</html>
VIEWER_EOF

# auth-websockify is created as a separate step after install

# Configure cmux-code directories and default settings (matches E2B layout)
mkdir -p /root/.vscode-server-oss/data/User/profiles/default-profile
mkdir -p /root/.vscode-server-oss/data/User/snippets
mkdir -p /root/.vscode-server-oss/data/Machine
mkdir -p /root/.vscode-server-oss/extensions
cat > /root/.vscode-server-oss/data/User/settings.json << 'SETTINGS_EOF'
{
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.tips.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.minimap.enabled": false,
  "editor.formatOnSave": true,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "terminal.integrated.fontSize": 14,
  "terminal.integrated.shellIntegration.enabled": false,
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "security.workspace.trust.untrustedFiles": "open",
  "security.workspace.trust.emptyWindow": false,
  "extensions.verifySignature": false,
  "git.openDiffOnClick": true,
  "scm.defaultViewMode": "tree",
  "settingsSync.ignoredSettings": []
}
SETTINGS_EOF
cp /root/.vscode-server-oss/data/User/settings.json /root/.vscode-server-oss/data/User/profiles/default-profile/settings.json
cp /root/.vscode-server-oss/data/User/settings.json /root/.vscode-server-oss/data/Machine/settings.json

# Clean apt cache to reduce snapshot size
apt-get clean > /dev/null 2>&1
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

echo "INSTALL_COMPLETE"
`;

/**
 * Execute a bash command in a sandbox and return stdout/stderr/exit_code.
 */
async function execBash(
  sandbox: Awaited<ReturnType<InstanceType<typeof ModalClient>["sandboxes"]["create"]>>,
  command: string,
) {
  const proc = await sandbox.exec(["bash", "-c", command]);
  const stdout = await proc.stdout.readText();
  const stderr = await proc.stderr.readText();
  const exitCode = await proc.wait();
  return { stdout, stderr, exit_code: exitCode ?? 0 };
}

/**
 * Update the modal-snapshots.json manifest with a new snapshot version.
 */
function updateSnapshotManifest(snapshotId: string, baseImage: string): void {
  const manifest = JSON.parse(readFileSync(MODAL_SNAPSHOTS_PATH, "utf-8"));
  const existingVersions = manifest.snapshots as Array<{
    version: number;
    snapshotId: string;
    image: string;
    capturedAt: string;
  }>;

  const maxVersion = existingVersions.reduce(
    (max, s) => Math.max(max, s.version),
    0,
  );

  existingVersions.push({
    snapshotId,
    version: maxVersion + 1,
    image: baseImage,
    capturedAt: new Date().toISOString(),
  });

  manifest.updatedAt = new Date().toISOString();
  manifest.snapshots = existingVersions;

  writeFileSync(MODAL_SNAPSHOTS_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `[build-snapshot] Updated modal-snapshots.json (version ${maxVersion + 1})`,
  );
}

async function main() {
  const client = new ModalClient({
    tokenId: env.MODAL_TOKEN_ID,
    tokenSecret: env.MODAL_TOKEN_SECRET,
  });

  const baseImage = "python:3.13-slim";

  try {
    console.log(`[build-snapshot] Creating sandbox from ${baseImage}...`);
    const startTime = Date.now();

    const app = await client.apps.fromName("cmux-devbox", {
      createIfMissing: true,
    });
    const image = client.images.fromRegistry(baseImage);

    const sandbox = await client.sandboxes.create(app, image, {
      timeoutMs: 30 * 60 * 1000,
      encryptedPorts: [8888, 39377, 39378, 39380],
    });

    console.log(
      `[build-snapshot] Sandbox created: ${sandbox.sandboxId} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`,
    );

    console.log("[build-snapshot] Running install script...");
    const installStart = Date.now();
    const result = await execBash(sandbox, INSTALL_SCRIPT);

    if (result.exit_code !== 0) {
      console.error("[build-snapshot] Install failed:");
      console.error("stdout:", result.stdout);
      console.error("stderr:", result.stderr);
      process.exit(1);
    }

    console.log(
      `[build-snapshot] Install complete (${((Date.now() - installStart) / 1000).toFixed(1)}s)`,
    );

    // Upload locally-built worker-daemon if available (overrides the release binary)
    const localWorkerDaemon = resolve(
      import.meta.dirname!,
      "/tmp/worker-daemon-linux",
    );
    if (existsSync(localWorkerDaemon)) {
      console.log("[build-snapshot] Uploading local worker-daemon binary...");
      const binary = readFileSync(localWorkerDaemon);
      const b64 = binary.toString("base64");
      const chunkSize = 65536;
      const chunks = Math.ceil(b64.length / chunkSize);
      await execBash(sandbox, "rm -f /tmp/worker-daemon.b64");
      for (let i = 0; i < chunks; i++) {
        const chunk = b64.slice(i * chunkSize, (i + 1) * chunkSize);
        await execBash(
          sandbox,
          `printf '%s' '${chunk}' >> /tmp/worker-daemon.b64`,
        );
      }
      const uploadResult = await execBash(
        sandbox,
        "base64 -d /tmp/worker-daemon.b64 > /usr/local/bin/worker-daemon && chmod +x /usr/local/bin/worker-daemon && rm /tmp/worker-daemon.b64 && echo UPLOAD_OK",
      );
      if (uploadResult.stdout.includes("UPLOAD_OK")) {
        console.log(
          "[build-snapshot] Local worker-daemon uploaded successfully",
        );
      } else {
        console.error(
          "[build-snapshot] Failed to upload worker-daemon:",
          uploadResult.stderr,
        );
      }
    }

    // VNC auth proxy is now built into the Go worker daemon binary (no separate JS file needed)

    console.log("[build-snapshot] Snapshotting filesystem...");
    const snapStart = Date.now();
    const snapshotImage = await sandbox.snapshotFilesystem(5 * 60 * 1000);
    const snapshotImageId = snapshotImage.imageId;
    console.log(
      `[build-snapshot] Snapshot created: ${snapshotImageId} (${((Date.now() - snapStart) / 1000).toFixed(1)}s)`,
    );

    await sandbox.terminate();

    // Auto-update the modal-snapshots.json manifest
    updateSnapshotManifest(snapshotImageId, baseImage);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[build-snapshot] Done in ${totalTime}s`);
    console.log(`\nSnapshot ID: ${snapshotImageId}`);
    console.log(
      `\nManifest updated at: ${MODAL_SNAPSHOTS_PATH}`,
    );
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
