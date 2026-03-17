import { io } from "socket.io-client";

const socket = io("http://localhost:9776", {
  transports: ["websocket"],
  auth: {
    token: process.env.AUTH_TOKEN || "test-token",
  },
});

socket.on("connect", () => {
  console.log("Connected to server");
  
  // Trigger the local-cloud-sync
  socket.emit(
    "trigger-local-cloud-sync",
    {
      localWorkspacePath: "/Users/austinwang/cmux/local-workspaces/landing-n",
      cloudTaskRunId: "kd7c99bkv34n5h4paj474048n5801rf0",
    },
    (response: { success: boolean; error?: string; message?: string; filesQueued?: number }) => {
      console.log("Response:", JSON.stringify(response, null, 2));
      setTimeout(() => process.exit(0), 2000);
    }
  );
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 30000);
