import net from "node:net";
import { URL } from "node:url";
import { WebSocket } from "ws";
import { serverLogger } from "../utils/fileLogger";

export type TcpProxyHandle = {
  port: number;
  close: () => Promise<void>;
};

type TcpProxyOptions = {
  baseUrl: string;
  sandboxId: string;
  targetPort: number;
  label: string;
};

function buildProxyUrl(baseUrl: string, sandboxId: string, targetPort: number): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/sandboxes/${encodeURIComponent(sandboxId)}/proxy`;
  url.searchParams.set("port", targetPort.toString());
  return url.toString();
}

export async function createSandboxTcpProxy(
  options: TcpProxyOptions
): Promise<TcpProxyHandle> {
  const { baseUrl, sandboxId, targetPort, label } = options;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.pause();

    const wsUrl = buildProxyUrl(baseUrl, sandboxId, targetPort);
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    ws.binaryType = "arraybuffer";

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      socket.destroy();
    };

    ws.on("open", () => {
      socket.resume();
    });

    ws.on("message", (data) => {
      if (typeof data === "string") {
        socket.write(data);
        return;
      }
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.from(data);
      socket.write(buffer);
    });

    ws.on("error", (error) => {
      serverLogger.error(
        `[sandbox-proxy:${label}] WebSocket error (port ${targetPort})`,
        error
      );
      cleanup();
    });

    ws.on("close", () => {
      socket.end();
    });

    socket.on("data", (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(chunk, { binary: true }, (error) => {
        if (error) {
          serverLogger.error(
            `[sandbox-proxy:${label}] WebSocket send failed (port ${targetPort})`,
            error
          );
          cleanup();
        }
      });
    });

    socket.on("error", (error) => {
      serverLogger.error(
        `[sandbox-proxy:${label}] Socket error (port ${targetPort})`,
        error
      );
      cleanup();
    });

    socket.on("close", () => {
      sockets.delete(socket);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", (error) => {
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind sandbox proxy port"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}
