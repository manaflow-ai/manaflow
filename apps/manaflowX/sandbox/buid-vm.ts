import { MorphCloudClient } from "morphcloud";

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

  // Install opencode dependencies
  console.log("Installing opencode dependencies...");
  const installDeps = await instance.exec("cd /root/opencode && bun install", {
    timeout: 600000,
  });
  console.log("Install deps stdout:", installDeps.stdout);
  if (installDeps.stderr) console.log("Install deps stderr:", installDeps.stderr);

  // Build opencode to resolve macros
  console.log("Building opencode...");
  const buildResult = await instance.exec(
    "cd /root/opencode/packages/opencode && bun run build",
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

  // Create workspace directory
  console.log("Creating workspace directory...");
  await instance.exec("mkdir -p /root/workspace");

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
export OPENCODE_CONFIG_CONTENT='{"model":"opencode/grok-code"}'
export BUN_PTY_LIB="/root/opencode/node_modules/.bun/bun-pty@0.4.2/node_modules/bun-pty/rust-pty/target/release/librust_pty.so"
nohup /root/opencode/packages/opencode/dist/opencode serve --hostname=0.0.0.0 --port=4096 > /root/server.log 2>&1 &
echo $! > /root/server.pid
EOF`);
  await instance.exec("chmod +x /root/start-server.sh");

  // Run the server
  console.log("Starting server...");
  await instance.exec("bash -c '/root/start-server.sh'");

  // Give server time to start
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log("Server started!");

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
