import { io } from "socket.io-client";

// Get auth token from environment or use a test approach
const TEAM_ID = "53891ec7-ffb7-48f4-b467-b13c4b5ac4db";
const TASK_RUN_ID = "kd7c99bkv34n5h4paj474048n5801rf0";
const LOCAL_WORKSPACE = "/Users/austinwang/cmux/local-workspaces/landing-n";

console.log("Connecting to socket server...");

const socket = io("http://localhost:9776", {
  transports: ["websocket"],
  query: {
    team: TEAM_ID,
  },
});

socket.on("connect", () => {
  console.log("Connected to server, socket id:", socket.id);

  // Small delay to let connection stabilize
  setTimeout(() => {
    console.log("Triggering local-cloud sync...");
    console.log("  Local workspace:", LOCAL_WORKSPACE);
    console.log("  Cloud task run:", TASK_RUN_ID);

    socket.emit(
      "trigger-local-cloud-sync",
      {
        localWorkspacePath: LOCAL_WORKSPACE,
        cloudTaskRunId: TASK_RUN_ID,
      },
      (response: { success: boolean; error?: string; message?: string; filesQueued?: number }) => {
        console.log("\n=== RESPONSE ===");
        console.log(JSON.stringify(response, null, 2));

        if (response.success) {
          console.log("\n✅ Sync triggered successfully!");
          if (response.filesQueued) {
            console.log(`   Files queued: ${response.filesQueued}`);
          }
        } else {
          console.log("\n❌ Sync failed:", response.error);
        }

        // Wait a bit to see any follow-up logs, then exit
        setTimeout(() => {
          console.log("\nDisconnecting...");
          socket.disconnect();
          process.exit(response.success ? 0 : 1);
        }, 3000);
      }
    );
  }, 500);
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error.message);
  process.exit(1);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});

// Timeout
setTimeout(() => {
  console.error("Timeout - no response received");
  process.exit(1);
}, 30000);
