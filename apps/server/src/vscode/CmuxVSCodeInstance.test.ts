import { getContainerWorkspacePath } from "@cmux/shared/node/workspace-path";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAuth } from "../utils/requestContext";
import { CmuxVSCodeInstance } from "./CmuxVSCodeInstance";

const CONTAINER_WORKSPACE_PATH = getContainerWorkspacePath();

describe("CmuxVSCodeInstance basic lifecycle via local API stub", () => {
  let server: ReturnType<typeof createServer> | null = null;
  let baseUrl = "";
  const calls: { method: string; url: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const method = req.method || "";
      const url = req.url || "";
      calls.push({ method, url });
      if (method === "POST" && url === "/api/sandboxes/start") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            instanceId: "sandbox_local_1",
            vscodeUrl: "http://127.0.0.1:39999",
            workerUrl: "http://127.0.0.1:39998", // unreachable; connectToWorker will be tried and may error silently
            provider: "morph",
          })
        );
        return;
      }
      if (method === "GET" && url === "/api/sandboxes/sandbox_local_1/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            running: true,
            vscodeUrl: "http://127.0.0.1:39999",
            workerUrl: "http://127.0.0.1:39998",
            provider: "morph",
          })
        );
        return;
      }
      if (method === "POST" && url === "/api/sandboxes/sandbox_local_1/stop") {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    }).listen(0);

    await new Promise<void>((resolve) =>
      server!.on("listening", () => resolve())
    );
    const addr = server.address();
    if (addr && typeof addr === "object" && addr.port) {
      baseUrl = `http://localhost:${addr.port}`;
      process.env.NEXT_PUBLIC_WWW_ORIGIN = baseUrl;
    } else {
      throw new Error("Failed to get test server port");
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("start → status → stop works against stub API", async () => {
    await runWithAuth(
      "test-token",
      JSON.stringify({
        accessToken: "test-token",
        refreshToken: "test-refresh",
      }),
      async () => {
        const taskRunId = typedZid("taskRuns").parse("tr1");
        const taskId = typedZid("tasks").parse("t1");
        const inst = new CmuxVSCodeInstance({
          taskRunId,
          taskId,
          teamSlugOrId: "default",
          agentName: "test-agent",
        });

        const info = await inst.start();
        expect(info.instanceId).toBe(taskRunId);
        expect(info.provider).toBe("morph");
        expect(info.url).toBe("http://127.0.0.1:39999");
        expect(
          info.workspaceUrl.includes(`/?folder=${CONTAINER_WORKSPACE_PATH}`)
        ).toBe(true);

        const st = await inst.getStatus();
        expect(st.running).toBe(true);
        expect(st.info?.url).toBe("http://127.0.0.1:39999");

        await inst.stop();

        // Verify API calls were made
        const startCall = calls.find(
          (c) => c.method === "POST" && c.url === "/api/sandboxes/start"
        );
        const stopCall = calls.find(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/sandboxes/sandbox_local_1/stop"
        );
        expect(startCall).toBeTruthy();
        expect(stopCall).toBeTruthy();
      }
    );
  });
});
