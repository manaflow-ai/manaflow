import { isElectron } from "@/lib/electron";
import { useContext } from "react";
import { socketBoot } from "./socket-boot";
import { ElectronSocketContext, WebSocketContext } from "./socket-context";
import type { CmuxSocket } from "./types";

// Suspense helpers for socket readiness
const CONNECT_TIMEOUT_MS = 15_000;

type Suspender = {
  promise: Promise<void>;
  cleanup: () => void;
};

const socketSuspenders = new WeakMap<CmuxSocket, Suspender>();

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

function createSocketSuspender(socket: CmuxSocket): Suspender {
  let timeoutId: number | undefined;
  let settled = false;
  let lastError: Error | null = null;

  const onConnect = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };
  const onConnectError = (err: unknown) => {
    // Do not reject immediately; allow auto-retry within timeout window
    lastError = normalizeError(err);
  };

  let resolve!: () => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    // We'll only use the local 'rej' when timing out
    // Attach listeners once
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    // Guard against hanging forever
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const reason = lastError
        ? new Error(`Socket connect timeout: ${lastError.message}`)
        : new Error("Socket connect timeout");
      rej(reason);
    }, CONNECT_TIMEOUT_MS) as unknown as number;
  });

  const cleanup = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    socket.off("connect", onConnect);
    socket.off("connect_error", onConnectError);
  };

  return { promise, cleanup };
}

function getSuspender(socket: CmuxSocket): Suspender {
  let susp = socketSuspenders.get(socket);
  if (!susp) {
    susp = createSocketSuspender(socket);
    socketSuspenders.set(socket, susp);
  }
  return susp;
}

function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return ctx;
}

function useElectronSocket() {
  const ctx = useContext(ElectronSocketContext);
  if (!ctx) {
    throw new Error(
      "useElectronSocket must be used within a ElectronSocketProvider"
    );
  }
  return ctx;
}

export const useSocket = isElectron ? useElectronSocket : useWebSocket;

// Suspense variant: only returns when a connected socket is available.
// Otherwise throws a Promise to suspend until first successful connect
// or throws an Error if the initial connection fails.
export function useSocketSuspense() {
  const ctx = useSocket();
  const socket = ctx.socket;

  if (socket && ctx.isConnected) {
    // Narrow type: socket is non-null when connected
    return ctx as typeof ctx & { socket: CmuxSocket };
  }

  if (socket) {
    // Socket exists but not connected yet — suspend until connected
    const suspender = getSuspender(socket);
    throw suspender.promise;
  }

  // Socket not created yet: suspend until the provider signals boot readiness
  throw socketBoot.promise;
}
