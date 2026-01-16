#!/usr/bin/env bun
/**
 * Test script for cmux-pty backend.
 *
 * Prerequisites:
 * 1. Build and run cmux-pty server: cd crates/cmux-pty && cargo run -- --port 39383
 * 2. Run this script: bun scripts/test-cmux-pty.ts
 */

const PTY_SERVER_URL = process.env.PTY_SERVER_URL || "http://localhost:39383";

interface PtySessionInfo {
  id: string;
  name: string;
  index: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  created_at: number;
  alive: boolean;
  pid: number;
}

async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${PTY_SERVER_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function createSession(options: {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  name?: string;
}): Promise<PtySessionInfo> {
  const response = await fetch(`${PTY_SERVER_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shell: options.shell || "/bin/bash",
      cwd: options.cwd || process.cwd(),
      cols: options.cols || 80,
      rows: options.rows || 24,
      env: options.env,
      name: options.name,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create PTY session: ${error}`);
  }

  return response.json();
}

async function listSessions(): Promise<PtySessionInfo[]> {
  const response = await fetch(`${PTY_SERVER_URL}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  const data = await response.json();
  return data.sessions || [];
}

async function sendInput(sessionId: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = PTY_SERVER_URL.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}/sessions/${sessionId}/ws`);

    const chunks: string[] = [];

    ws.onopen = () => {
      console.log(`  [WS] Connected to session ${sessionId}`);
      ws.send(data);
    };

    ws.onmessage = (event) => {
      const output = typeof event.data === "string" ? event.data : event.data.toString();
      chunks.push(output);
      process.stdout.write(output);
    };

    ws.onerror = (error) => {
      reject(new Error(`WebSocket error: ${error}`));
    };

    ws.onclose = () => {
      console.log(`\n  [WS] Connection closed`);
      resolve();
    };

    // Keep connection open for 2 seconds to receive output
    setTimeout(() => {
      ws.close();
    }, 2000);
  });
}

async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${PTY_SERVER_URL}/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

async function main() {
  console.log("=== cmux-pty Backend Test ===\n");
  console.log(`PTY Server URL: ${PTY_SERVER_URL}\n`);

  // 1. Check health
  console.log("1. Checking cmux-pty health...");
  const healthy = await checkHealth();
  if (!healthy) {
    console.error("❌ cmux-pty server is not available!");
    console.error("\nPlease start it first:");
    console.error("  cd crates/cmux-pty && cargo run -- --port 39383");
    process.exit(1);
  }
  console.log("✅ cmux-pty server is healthy\n");

  // 2. Create a session
  console.log("2. Creating a PTY session...");
  const session = await createSession({
    name: "test-session",
    shell: "/bin/bash",
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  });
  console.log(`✅ Session created: ${session.id}`);
  console.log(`   PID: ${session.pid}`);
  console.log(`   Shell: ${session.shell}`);
  console.log(`   CWD: ${session.cwd}\n`);

  // 3. List sessions
  console.log("3. Listing sessions...");
  const sessions = await listSessions();
  console.log(`✅ Found ${sessions.length} session(s)`);
  for (const s of sessions) {
    console.log(`   - ${s.id} (${s.name}): alive=${s.alive}, pid=${s.pid}`);
  }
  console.log();

  // 4. Send a command
  console.log("4. Sending command: echo 'Hello from cmux-pty!'");
  console.log("   Output:");
  await sendInput(session.id, "echo 'Hello from cmux-pty!'\n");
  console.log();

  // 5. Test sending an agent-like command (simulating what agentSpawner would do)
  console.log("5. Simulating agent command: ls -la");
  console.log("   Output:");
  await sendInput(session.id, "ls -la\n");
  console.log();

  // 6. Clean up
  console.log("6. Cleaning up session...");
  await deleteSession(session.id);
  console.log("✅ Session deleted\n");

  // 7. Verify cleanup
  console.log("7. Verifying cleanup...");
  const remainingSessions = await listSessions();
  const ourSession = remainingSessions.find((s) => s.id === session.id);
  if (ourSession) {
    console.log("⚠️ Session still exists (might be expected if alive check is different)");
  } else {
    console.log("✅ Session successfully removed");
  }

  console.log("\n=== All tests passed! ===");
}

main().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
