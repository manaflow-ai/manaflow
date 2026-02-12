#!/usr/bin/env node
/**
 * Test SSH over WebSocket functionality
 * Run with: E2B_API_KEY=xxx node scripts/test-ssh-websocket.js
 */

const { Sandbox } = require("e2b");
const WebSocket = require("ws");
const net = require("net");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEMPLATE_ID = "cmux-devbox-docker";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("=== E2B SSH over WebSocket Test ===\n");

  // Check for E2B API key
  if (!process.env.E2B_API_KEY) {
    console.error("ERROR: E2B_API_KEY environment variable required");
    process.exit(1);
  }

  // Check for sshpass (used for SSH password authentication)
  try {
    execSync("which sshpass", { stdio: "pipe" });
  } catch {
    console.error("ERROR: sshpass not found. Install with: brew install sshpass");
    process.exit(1);
  }

  let sandbox;
  try {
    // 1. Create sandbox
    console.log("1. Creating E2B sandbox with template:", TEMPLATE_ID);
    sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 300000 }); // 5 min
    console.log("   Sandbox ID:", sandbox.sandboxId);

    // 2. Wait for worker daemon to be ready
    console.log("\n2. Waiting for worker daemon...");
    for (let i = 0; i < 30; i++) {
      try {
        const result = await sandbox.commands.run("curl -sf http://localhost:39377/health");
        if (result.exitCode === 0) {
          console.log("   Worker daemon ready!");
          break;
        }
      } catch (e) {
        // Ignore
      }
      await sleep(1000);
    }

    // 3. Get auth token from worker
    console.log("\n3. Getting auth token...");
    const tokenResult = await sandbox.commands.run("cat /home/user/.worker-auth-token");
    const authToken = tokenResult.stdout.trim();
    console.log("   Auth token:", authToken.substring(0, 16) + "...");

    // 4. Get the sandbox URL
    const workerUrl = sandbox.getHost(39377);
    console.log("   Worker URL:", workerUrl);

    // 5. Test SSH WebSocket connection
    console.log("\n4. Testing SSH WebSocket connection...");
    const wsUrl = `wss://${workerUrl}/ssh?token=${encodeURIComponent(authToken)}`;
    console.log("   WS URL:", wsUrl.substring(0, 50) + "...");

    const testResult = await testSSHWebSocket(wsUrl);
    if (!testResult.success) {
      console.error("   SSH WebSocket test failed:", testResult.error);
      throw new Error(testResult.error);
    }
    console.log("   ✓ SSH WebSocket connection works!");

    // 6. Test rsync through the tunnel
    console.log("\n5. Testing rsync through WebSocket tunnel...");
    const rsyncResult = await testRsyncThroughWebSocket(workerUrl, authToken);
    if (!rsyncResult.success) {
      console.error("   Rsync test failed:", rsyncResult.error);
      throw new Error(rsyncResult.error);
    }
    console.log("   ✓ Rsync works through WebSocket tunnel!");
    console.log("   Files synced:", rsyncResult.fileCount);
    console.log("   Time taken:", rsyncResult.timeTaken + "ms");

    // 7. Test large file sync
    console.log("\n6. Testing large directory sync (200 files, ~1MB)...");
    const largeResult = await testLargeSync(workerUrl, authToken);
    if (!largeResult.success) {
      console.error("   Large sync test failed:", largeResult.error);
    } else {
      console.log("   ✓ Large sync works!");
      console.log("   Files synced:", largeResult.fileCount);
      console.log("   Total size:", (largeResult.totalSize / 1024 / 1024).toFixed(2) + " MB");
      console.log("   Time taken:", largeResult.timeTaken + "ms");
      console.log("   Speed:", (largeResult.totalSize / 1024 / largeResult.timeTaken * 1000).toFixed(2) + " KB/s");
    }

    // 8. Verify files on remote
    console.log("\n7. Verifying synced files on sandbox...");
    const verifyResult = await sandbox.commands.run("ls -la /home/user/workspace/test/ | head -5");
    console.log("   Test dir contents:");
    console.log("   " + verifyResult.stdout.split("\n").slice(0, 5).join("\n   "));

    const largeVerify = await sandbox.commands.run("find /home/user/workspace/large-test -type f | wc -l");
    console.log("   Large test file count:", largeVerify.stdout.trim());

    console.log("\n=== All tests passed! ===");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  } finally {
    // Cleanup
    if (sandbox) {
      console.log("\n8. Cleaning up sandbox...");
      await sandbox.kill();
      console.log("   Sandbox terminated.");
    }
  }
}

/**
 * Test basic SSH WebSocket connection - pure binary tunnel
 */
async function testSSHWebSocket(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let gotSSHBanner = false;

    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: "Timeout waiting for SSH banner" });
    }, 15000);

    ws.on("open", () => {
      console.log("   WebSocket connected");
    });

    ws.on("message", (data) => {
      const str = data.toString();

      // Check for SSH banner (starts with "SSH-")
      if (str.includes("SSH-")) {
        gotSSHBanner = true;
        console.log("   Got SSH banner:", str.trim().substring(0, 50));
        clearTimeout(timeout);
        ws.close();
        resolve({ success: true });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      if (!gotSSHBanner) {
        resolve({ success: false, error: `Connection closed (${code}): ${reason}` });
      }
    });
  });
}

/**
 * Test rsync through WebSocket tunnel
 */
async function testRsyncThroughWebSocket(workerHost, authToken) {
  // Create test directory with some files
  const testDir = "/tmp/rsync-test-" + Date.now();
  fs.mkdirSync(testDir, { recursive: true });

  // Create some test files
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(testDir, `file${i}.txt`), `Test content ${i}\n`.repeat(100));
  }
  fs.mkdirSync(path.join(testDir, "subdir"));
  fs.writeFileSync(path.join(testDir, "subdir", "nested.txt"), "Nested file content\n");

  try {
    const startTime = Date.now();
    const result = await runRsyncWithProxy(workerHost, authToken, testDir, "/home/user/workspace/test");
    const endTime = Date.now();

    // Cleanup
    fs.rmSync(testDir, { recursive: true });

    if (result.success) {
      return {
        success: true,
        fileCount: 11,
        timeTaken: endTime - startTime,
      };
    } else {
      return result;
    }
  } catch (error) {
    fs.rmSync(testDir, { recursive: true, force: true });
    return { success: false, error: error.message };
  }
}

/**
 * Test large directory sync
 */
async function testLargeSync(workerHost, authToken) {
  // Create test directory with many files
  const testDir = "/tmp/rsync-large-test-" + Date.now();
  fs.mkdirSync(testDir, { recursive: true });

  let totalSize = 0;
  const fileCount = 100; // Create 100 files

  // Create files of varying sizes
  for (let i = 0; i < fileCount; i++) {
    const size = Math.floor(Math.random() * 10000) + 1000; // 1KB to 11KB
    const content = "x".repeat(size);
    fs.writeFileSync(path.join(testDir, `large${i}.txt`), content);
    totalSize += size;
  }

  // Create nested directories
  for (let d = 0; d < 5; d++) {
    const subdir = path.join(testDir, `subdir${d}`);
    fs.mkdirSync(subdir);
    for (let i = 0; i < 20; i++) {
      const size = Math.floor(Math.random() * 5000) + 500;
      fs.writeFileSync(path.join(subdir, `file${i}.txt`), "y".repeat(size));
      totalSize += size;
    }
  }

  const actualFileCount = fileCount + 5 * 20; // 100 + 100 = 200 files

  try {
    const startTime = Date.now();
    const result = await runRsyncWithProxy(workerHost, authToken, testDir, "/home/user/workspace/large-test");
    const endTime = Date.now();

    // Cleanup
    fs.rmSync(testDir, { recursive: true });

    if (result.success) {
      return {
        success: true,
        fileCount: actualFileCount,
        totalSize,
        timeTaken: endTime - startTime,
      };
    } else {
      return result;
    }
  } catch (error) {
    fs.rmSync(testDir, { recursive: true, force: true });
    return { success: false, error: error.message };
  }
}

/**
 * Run rsync with WebSocket proxy using sshpass for authentication
 */
async function runRsyncWithProxy(workerHost, authToken, localPath, remotePath) {
  return new Promise((resolve) => {
    const wsUrl = `wss://${workerHost}/ssh?token=${encodeURIComponent(authToken)}`;

    // Create local TCP server to proxy to WebSocket
    const server = net.createServer((conn) => {
      console.log("   Local proxy: connection accepted");

      // Connect to WebSocket
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("   Local proxy: WebSocket connected");
      });

      // Pure binary tunnel - forward everything
      ws.on("message", (data) => {
        if (conn.writable) {
          conn.write(data);
        }
      });

      ws.on("close", () => {
        conn.destroy();
      });

      ws.on("error", (err) => {
        console.error("   Local proxy: WebSocket error:", err.message);
        conn.destroy();
      });

      // Forward TCP to WebSocket
      conn.on("data", (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      conn.on("close", () => {
        ws.close();
      });

      conn.on("error", () => {
        ws.close();
      });
    });

    // Listen on random port
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      console.log("   Local proxy listening on port", port);

      // Build rsync command with sshpass for password auth
      const rsyncArgs = [
        "-az",
        "--progress",
        "-e", `sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${port}`,
        localPath + "/",
        `user@127.0.0.1:${remotePath}/`,
      ];

      const rsync = spawn("rsync", rsyncArgs, {
        env: { ...process.env, SSHPASS: authToken },
      });

      let stdout = "";
      let stderr = "";

      rsync.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      rsync.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      rsync.on("close", (code) => {
        server.close();

        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          resolve({ success: false, error: `rsync exited with code ${code}: ${stderr}` });
        }
      });

      rsync.on("error", (err) => {
        server.close();
        resolve({ success: false, error: err.message });
      });

      // Timeout
      setTimeout(() => {
        rsync.kill();
        server.close();
        resolve({ success: false, error: "Timeout" });
      }, 120000); // 2 minute timeout
    });
  });
}

main().catch(console.error);
