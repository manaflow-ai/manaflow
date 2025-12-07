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

  // Install Bun
  console.log("Installing Bun...");
  const bunInstall = await instance.exec(
    "curl -fsSL https://bun.sh/install | bash"
  );
  console.log("Bun install stdout:", bunInstall.stdout);
  if (bunInstall.stderr) console.log("Bun install stderr:", bunInstall.stderr);

  // Symlink bun to /usr/local/bin
  console.log("Symlinking bun to /usr/local/bin...");
  await instance.exec("ln -sf /root/.bun/bin/bun /usr/local/bin/bun");

  // Verify bun
  const bunVerify = await instance.exec("which bun && bun --version");
  console.log("Bun verify:", bunVerify.stdout);

  // Install opencode CLI
  console.log("Installing opencode CLI...");
  const installResult = await instance.exec(
    "curl -fsSL https://opencode.ai/install | bash"
  );
  console.log("Install stdout:", installResult.stdout);
  if (installResult.stderr) console.log("Install stderr:", installResult.stderr);

  // Symlink opencode to /usr/local/bin so it's in PATH
  console.log("Symlinking opencode to /usr/local/bin...");
  await instance.exec("ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode");

  // Verify
  console.log("Verifying opencode installation...");
  const verifyResult = await instance.exec("which opencode && opencode --version");
  console.log("Verify result:", verifyResult.stdout);
  if (verifyResult.stderr) console.log("Verify stderr:", verifyResult.stderr);

  // Upload the worker source files via SSH
  console.log("Uploading worker files via SSH...");
  const ssh = await instance.ssh();

  // Create worker directory
  await instance.exec("mkdir -p /root/worker");

  // Upload source files
  await ssh.putFile("./worker/index.ts", "/root/worker/index.ts");
  await ssh.putFile("./worker/package.json", "/root/worker/package.json");
  console.log("Source files uploaded!");

  // Install dependencies
  console.log("Installing dependencies...");
  const installDeps = await instance.exec("cd /root/worker && bun install");
  console.log("Install deps stdout:", installDeps.stdout);
  if (installDeps.stderr) console.log("Install deps stderr:", installDeps.stderr);

  // Install bun-pty and set up the native library
  console.log("Installing bun-pty...");
  await instance.exec("cd /root/.opencode && bun add bun-pty");

  // Copy .so to worker directory for cwd fallback path
  await instance.exec(
    "mkdir -p /root/worker/node_modules/bun-pty/rust-pty/target/release && cp /root/.opencode/node_modules/bun-pty/rust-pty/target/release/*.so /root/worker/node_modules/bun-pty/rust-pty/target/release/"
  );

  // Create a startup script with BUN_PTY_LIB env var
  console.log("Creating startup script...");
  await instance.exec(`cat > /root/start-server.sh << 'EOF'
#!/bin/bash
cd /root/worker
export BUN_PTY_LIB=/root/worker/node_modules/bun-pty/rust-pty/target/release/librust_pty.so
nohup bun run index.ts > /root/server.log 2>&1 &
echo $! > /root/server.pid
EOF`);
  await instance.exec("chmod +x /root/start-server.sh");

  // Run the server in the background using bash -c with proper detachment
  console.log("Starting server...");
  await instance.exec("bash -c '/root/start-server.sh'");

  // Give server a moment to start
  await new Promise((resolve) => setTimeout(resolve, 5000));
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

  // Give it a moment to stabilize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Create snapshot of the running instance
  console.log("Creating snapshot of running instance...");
  const finalSnapshot = await instance.snapshot();
  console.log(`\n=== FINAL SNAPSHOT ===`);
  console.log(`Snapshot ID: ${finalSnapshot.id}`);

  // Get all services info from instance networking
  console.log(`\n=== SERVICES ===`);
  // Refresh instance to get latest networking info
  const refreshedInstance = await client.instances.get({ instanceId: instance.id });
  for (const svc of refreshedInstance.networking.httpServices) {
    console.log(`- ${svc.name}: ${svc.url}`);
  }

  // Close SSH connection
  ssh.dispose();

  console.log("\nDone!");
})();
