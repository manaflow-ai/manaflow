import { MorphCloudClient } from "morphcloud";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new MorphCloudClient({
  apiKey: process.env.MORPH_API_KEY!,
});

(async () => {
  console.log("Creating initial snapshot...");
  const snapshot = await client.snapshots.create({
    vcpus: 6,
    memory: 24576,
    diskSize: 48000,
    imageId: "morphvm-minimal",
  });
  console.log(`Created snapshot: ${snapshot.id}`);

  console.log("Starting instance...");
  const instance = await client.instances.start({
    snapshotId: snapshot.id,
  });
  console.log(`Started instance: ${instance.id}`);

  console.log("Waiting for instance to be ready...");
  await instance.waitUntilReady(30);
  console.log("Instance is ready!");

  // Install git
  console.log("Installing git...");
  await instance.exec("apt-get update && apt-get install -y git", {
    timeout: 120000,
  });

  // Install Bun 1.3.3 (required by opencode)
  console.log("Installing Bun 1.3.3...");
  const bunInstall = await instance.exec(
    "curl -fsSL https://bun.sh/install | bash -s 'bun-v1.3.3'"
  );
  console.log("Bun install stdout:", bunInstall.stdout);

  // Symlink bun to /usr/local/bin
  console.log("Symlinking bun to /usr/local/bin...");
  await instance.exec("ln -sf /root/.bun/bin/bun /usr/local/bin/bun");

  // Verify bun
  const bunVerify = await instance.exec("which bun && bun --version");
  console.log("Bun verify:", bunVerify.stdout);

  // Clone opencode repo
  console.log("Cloning opencode repo...");
  const cloneResult = await instance.exec(
    "git clone --depth 1 --branch dev https://github.com/sst/opencode.git /root/opencode",
    { timeout: 120000 }
  );
  console.log("Clone stdout:", cloneResult.stdout);
  if (cloneResult.stderr) console.log("Clone stderr:", cloneResult.stderr);

  // Patch terminal.tsx to fix WebSocket URL double-slash bug
  // The original code does: sdk.url + `/pty/...` which when sdk.url="/" creates "//pty/..."
  // The browser interprets "//pty/..." as a protocol-relative URL with hostname "pty"
  console.log("Patching terminal.tsx for WebSocket URL fix...");
  await instance.exec(`cat > /tmp/ws-fix.patch << 'PATCH'
--- a/packages/desktop/src/components/terminal.tsx
+++ b/packages/desktop/src/components/terminal.tsx
@@ -25,7 +25,12 @@ export const Terminal = (props: TerminalProps) => {
   onMount(async () => {
     ghostty = await Ghostty.load()

-    ws = new WebSocket(sdk.url + \`/pty/\${local.pty.id}/connect?directory=\${encodeURIComponent(sdk.directory)}\`)
+    // Construct WebSocket URL properly, handling both absolute and relative URLs
+    const baseUrl = sdk.url.replace(/\\/$/, "") // Remove trailing slash if present
+    const path = \`/pty/\${local.pty.id}/connect?directory=\${encodeURIComponent(sdk.directory)}\`
+    // Convert http(s) to ws(s) for absolute URLs, keep relative URLs as-is
+    const wsUrl = baseUrl.startsWith("http") ? baseUrl.replace(/^http/, "ws") + path : baseUrl + path
+    ws = new WebSocket(wsUrl)
     term = new Term({
       cursorBlink: true,
       fontSize: 14,
PATCH`);
  const patchResult = await instance.exec("cd /root/opencode && git apply /tmp/ws-fix.patch 2>&1 || echo 'Patch failed'");
  console.log("Patch result:", patchResult.stdout || "Applied successfully");
  // Verify patch
  const patchVerify = await instance.exec("grep -n 'baseUrl' /root/opencode/packages/desktop/src/components/terminal.tsx | head -3");
  console.log("Patch verify:", patchVerify.stdout || "No match found");

  // Install opencode dependencies
  console.log("Installing opencode dependencies...");
  const installDeps = await instance.exec("cd /root/opencode && bun install", {
    timeout: 600000,
  });
  console.log("Install deps stdout:", installDeps.stdout);
  if (installDeps.stderr) console.log("Install deps stderr:", installDeps.stderr);

  // Build desktop package with our WebSocket fix
  console.log("Building desktop package...");
  const desktopBuildResult = await instance.exec(
    "cd /root/opencode/packages/desktop && bun run build",
    { timeout: 300000 }
  );
  console.log("Desktop build stdout:", desktopBuildResult.stdout);
  if (desktopBuildResult.stderr) console.log("Desktop build stderr:", desktopBuildResult.stderr);

  // Patch server.ts to serve static files from local desktop build instead of proxying
  console.log("Patching server.ts to serve local desktop build...");
  // Use bun to do the replacement with proper string handling
  await instance.exec(`cat > /tmp/patch-server.ts << 'PATCHTS'
const path = '/root/opencode/packages/opencode/src/server/server.ts';
let content = await Bun.file(path).text();

// Add import at top if not already present
if (!content.includes('serveStatic')) {
  content = 'import { serveStatic } from "hono/bun"\\n' + content;
}

// Find and replace the proxy block
// Looking for: .all("/*", async (c) => { ... return proxy(...desktop.dev.opencode...) ... })
const proxyBlockStart = content.indexOf('.all("/*", async (c) => {');
if (proxyBlockStart !== -1) {
  // Find the matching closing }) by counting braces
  let braceCount = 0;
  let started = false;
  let endPos = proxyBlockStart;
  for (let i = proxyBlockStart; i < content.length; i++) {
    if (content[i] === '{') {
      braceCount++;
      started = true;
    } else if (content[i] === '}') {
      braceCount--;
      if (started && braceCount === 0) {
        // Found matching }, but we need the trailing )
        endPos = i + 1;
        if (content[i + 1] === ')') endPos = i + 2;
        break;
      }
    }
  }

  const before = content.substring(0, proxyBlockStart);
  const after = content.substring(endPos);
  content = before + '.get("/*", serveStatic({ root: "/root/opencode/packages/desktop/dist" }))' + after;
  console.log('Replaced proxy block with serveStatic');
} else {
  console.log('Warning: proxy block not found');
}

await Bun.write(path, content);
console.log('Patched server.ts');
PATCHTS`);
  const patchServerResult = await instance.exec("bun /tmp/patch-server.ts 2>&1");
  console.log("Server patch result:", patchServerResult.stdout);

  // Verify the patch
  const serverPatchVerify = await instance.exec("grep -n 'serveStatic\\|desktop.dev.opencode' /root/opencode/packages/opencode/src/server/server.ts | tail -5");
  console.log("Server patch verify:", serverPatchVerify.stdout);

  // Build opencode CLI binary (after patching server)
  console.log("Building opencode CLI...");
  const buildResult = await instance.exec(
    "cd /root/opencode/packages/opencode && bun run build --single",
    { timeout: 300000 }
  );
  console.log("Build stdout:", buildResult.stdout);
  if (buildResult.stderr) console.log("Build stderr:", buildResult.stderr);

  // Upgrade glibc to 2.39+ (needed for bun-pty native library)
  console.log("Upgrading glibc...");
  // Add testing repo for newer glibc
  await instance.exec(`cat >> /etc/apt/sources.list << 'EOF'
deb http://deb.debian.org/debian testing main
EOF`);
  // Pin to prefer stable but allow testing packages when needed
  await instance.exec(`cat > /etc/apt/preferences.d/testing << 'EOF'
Package: *
Pin: release a=stable
Pin-Priority: 700

Package: *
Pin: release a=testing
Pin-Priority: 650
EOF`);
  const glibcUpgrade = await instance.exec(
    "apt-get update && apt-get install -y -t testing libc6",
    { timeout: 300000 }
  );
  console.log("Glibc upgrade stdout:", glibcUpgrade.stdout);
  if (glibcUpgrade.stderr) console.log("Glibc upgrade stderr:", glibcUpgrade.stderr);

  // Verify glibc version
  const glibcVerify = await instance.exec("ldd --version | head -1");
  console.log("Glibc version:", glibcVerify.stdout);

  // Install global CLI tools
  console.log("Installing global CLI tools...");
  const globalInstall = await instance.exec(
    "bun add -g @anthropic-ai/claude-code @openai/codex-cli @openai/codex-sdk @google/gemini-cli@preview",
    { timeout: 300000 }
  );
  console.log("Global install stdout:", globalInstall.stdout);
  if (globalInstall.stderr) console.log("Global install stderr:", globalInstall.stderr);

  // Copy grok-code binary and symlink to PATH
  console.log("Setting up grok-code binary...");
  await instance.exec("mkdir -p /root/grok-code");
  const ssh = await instance.ssh();
  const grokBinaryPath = join(__dirname, "worker/grok-code/vendor/linux-x64/grok");
  await ssh.putFile(grokBinaryPath, "/root/grok-code/grok");
  await instance.exec("chmod +x /root/grok-code/grok");
  await instance.exec("ln -sf /root/grok-code/grok /usr/local/bin/grok");
  const grokVerify = await instance.exec("which grok && grok --version 2>&1 || echo 'grok installed'");
  console.log("Grok verify:", grokVerify.stdout);
  ssh.dispose();

  // Create workspace directory and plugin directory
  console.log("Creating workspace and plugin directories...");
  await instance.exec("mkdir -p /root/workspace");
  await instance.exec("mkdir -p /root/workspace/.opencode/plugin");
  await instance.exec("mkdir -p /root/.xagi");

  // Copy the Convex sync plugin
  console.log("Installing OpenCode Convex sync plugin...");
  const pluginPath = join(__dirname, "opencode-plugin/convex-sync.ts");
  const pluginSsh = await instance.ssh();
  await pluginSsh.putFile(pluginPath, "/root/workspace/.opencode/plugin/convex-sync.ts");
  pluginSsh.dispose();
  const pluginVerify = await instance.exec("cat /root/workspace/.opencode/plugin/convex-sync.ts | head -20");
  console.log("Plugin installed:", pluginVerify.stdout ? "OK" : "Failed");

  // Pre-fetch models.json to avoid Bun macro issue
  console.log("Pre-fetching models.json...");
  await instance.exec(
    "mkdir -p /root/.cache/opencode && curl -s https://models.dev/api.json > /root/.cache/opencode/models.json"
  );

  // Create a simple server script that runs opencode serve using built binary
  console.log("Creating startup script...");
  await instance.exec(`cat > /root/start-server.sh << 'EOF'
#!/bin/bash
cd /root/workspace
export OPENCODE_CONFIG_CONTENT='{"model":"opencode/grok-code","plugin":["file:///root/workspace/.opencode/plugin/convex-sync.ts"]}'
export BUN_PTY_LIB="/root/opencode/node_modules/.bun/bun-pty@0.4.2/node_modules/bun-pty/rust-pty/target/release/librust_pty.so"
nohup /root/opencode/packages/opencode/dist/opencode-linux-x64/bin/opencode serve --hostname=0.0.0.0 --port=4096 > /root/server.log 2>&1 &
echo $! > /root/server.pid
EOF`);
  await instance.exec("chmod +x /root/start-server.sh");

  // Run the server
  console.log("Starting server...");
  await instance.exec("bash -c '/root/start-server.sh'");

  // Give server time to start
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Verify server is actually running before proceeding
  console.log("Verifying server is running...");
  for (let attempt = 0; attempt < 5; attempt++) {
    const serverCheck = await instance.exec(
      "ps aux | grep 'opencode serve' | grep -v grep"
    );
    if (serverCheck.stdout && serverCheck.stdout.includes("opencode")) {
      console.log("Server process confirmed running");
      break;
    }
    if (attempt === 4) {
      const logResult = await instance.exec("cat /root/server.log");
      console.error("Server log:", logResult.stdout);
      throw new Error("Server process not found after 5 attempts - cannot proceed");
    }
    console.log(`Server not found, retrying in 5s (attempt ${attempt + 1}/5)...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Verify server responds to HTTP
  console.log("Verifying server responds to HTTP...");
  const healthCheck = await instance.exec("curl -s http://localhost:4096/session");
  if (!healthCheck.stdout) {
    throw new Error("Server not responding to HTTP requests");
  }
  console.log("Server HTTP check passed");

  // Check server log
  const logResult = await instance.exec("cat /root/server.log");
  console.log("Server log:", logResult.stdout);
  if (logResult.stderr) console.log("Server stderr:", logResult.stderr);

  // Expose port 4096
  console.log("Exposing port 4096...");
  const service = await instance.exposeHttpService("port-4096", 4096);
  console.log(`Service exposed!`);
  console.log(`Service URL: ${service.url}`);
  console.log(`Service name: ${service.name}`);

  // Create snapshot
  console.log("Creating snapshot of running instance...");
  const finalSnapshot = await instance.snapshot();
  console.log(`\n=== FINAL SNAPSHOT ===`);
  console.log(`Snapshot ID: ${finalSnapshot.id}`);

  // Update vm-snapshots.json
  console.log("Updating vm-snapshots.json...");
  const snapshotsPath = join(__dirname, "vm-snapshots.json");
  const snapshotsData = JSON.parse(readFileSync(snapshotsPath, "utf-8"));

  const presetId = "6vcpu_24gb_48gb";
  let preset = snapshotsData.presets.find((p: { presetId: string }) => p.presetId === presetId);

  if (!preset) {
    preset = {
      presetId,
      label: "Standard workspace",
      cpu: "6 vCPU",
      memory: "24 GB RAM",
      disk: "48 GB SSD",
      versions: [],
      description: "Great default for day-to-day work. Balanced CPU, memory, and storage.",
    };
    snapshotsData.presets.push(preset);
  }

  const newVersion = {
    version: preset.versions.length + 1,
    snapshotId: finalSnapshot.id,
    capturedAt: new Date().toISOString(),
  };
  preset.versions.push(newVersion);
  snapshotsData.updatedAt = new Date().toISOString();

  writeFileSync(snapshotsPath, JSON.stringify(snapshotsData, null, 2));
  console.log(`Added version ${newVersion.version} with snapshot ${finalSnapshot.id}`);

  // Get all services
  console.log(`\n=== SERVICES ===`);
  const refreshedInstance = await client.instances.get({
    instanceId: instance.id,
  });
  for (const svc of refreshedInstance.networking.httpServices) {
    console.log(`- ${svc.name}: ${svc.url}`);
  }

  console.log("\nDone!");
})();
