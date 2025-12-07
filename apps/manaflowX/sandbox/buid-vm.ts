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

  // Upload the bun binary using SSH
  console.log("Uploading xagi-server binary via SSH...");
  const ssh = await instance.ssh();
  const binaryPath = "./worker/xagi-server";
  await ssh.putFile(binaryPath, "/root/xagi-server");
  console.log("Binary uploaded!");

  // Make it executable
  console.log("Making binary executable...");
  await instance.exec("chmod +x /root/xagi-server");

  // Run the server in the background using a proper nohup approach
  console.log("Starting server...");
  await instance.exec(
    "nohup /root/xagi-server > /root/server.log 2>&1 &"
  );

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
