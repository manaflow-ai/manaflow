import { request as httpRequest } from "node:http";

export async function checkDockerReadiness(): Promise<boolean> {
  const maxRetries = 100; // 10 seconds / 0.1 seconds
  const retryDelay = 100; // 100ms

  for (let i = 0; i < maxRetries; i++) {
    try {
      const success = await new Promise<boolean>((resolve) => {
        const req = httpRequest(
          {
            socketPath: "/var/run/docker.sock",
            path: "/_ping",
            method: "GET",
          },
          (res) => {
            const statusOk = res.statusCode === 200;
            res.resume();
            resolve(statusOk);
          }
        );

        req.setTimeout(1000, () => {
          req.destroy(new Error("timeout"));
        });

        req.on("error", () => resolve(false));
        req.end();
      });

      if (success) {
        return true;
      }
    } catch (_error) {
      // Ignore errors and retry
    }

    // Wait before retrying (except on last attempt)
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  return false;
}
