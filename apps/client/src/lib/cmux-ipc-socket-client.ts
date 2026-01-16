import type { ClientToServerEvents, ServerToClientEvents } from "@cmux/shared";

type EventHandler = (...args: unknown[]) => void;

const formatRpcErrorMessage = (event: string, error: unknown): string => {
  if (error instanceof Error) {
    return `RPC '${event}' failed: ${error.message}`;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return `RPC '${event}' failed: ${(error as { message: string }).message}`;
  }

  const fallback =
    typeof error === "string"
      ? error
      : (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        })();

  return `RPC '${event}' failed: ${fallback}`;
};

export class CmuxIpcSocketClient {
  private handlers = new Map<string, Set<EventHandler>>();
  private ipcCleanups = new Map<string, () => void>();
  public connected = false;
  public disconnected = true;
  public id = "cmux-ipc";
  private disposed = false;

  constructor(private readonly query: Record<string, string>) {}

  async connect() {
    if (this.connected) return this;
    await window.cmux.register({
      auth: this.query.auth,
      team: this.query.team,
      auth_json: this.query.auth_json,
    });
    this.connected = true;
    this.disconnected = false;

    // Wire existing handlers to IPC events (only if not already wired)
    this.handlers.forEach((_set, event) => {
      this.ensureIpcListener(event);
    });
    this.trigger("connect");
    return this;
  }

  private ensureIpcListener(event: string) {
    // Skip if already registered or disposed
    if (this.ipcCleanups.has(event) || this.disposed) return;
    const cleanup = window.cmux.on(event, (...args: unknown[]) => {
      if (!this.disposed) {
        this.trigger(event, ...args);
      }
    });
    this.ipcCleanups.set(event, cleanup);
  }

  disconnect() {
    if (this.disposed) return this;
    this.disposed = true;
    this.connected = false;
    this.disconnected = true;
    this.trigger("disconnect");
    // Clean up all IPC listeners to prevent memory leaks
    for (const cleanup of this.ipcCleanups.values()) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.ipcCleanups.clear();
    this.handlers.clear();
    return this;
  }

  on<E extends keyof ServerToClientEvents>(
    event: E | string,
    handler: ServerToClientEvents[E] | EventHandler
  ) {
    const key = String(event);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler as EventHandler);
    // Subscribe to IPC if connected (deduped via ensureIpcListener)
    if (this.connected) {
      this.ensureIpcListener(key);
    }
    return this;
  }
  //window.api.cmux

  off<E extends keyof ServerToClientEvents>(
    event?: E | string,
    handler?: ServerToClientEvents[E] | EventHandler
  ) {
    if (!event) {
      this.handlers.clear();
      return this;
    }
    const key = String(event);
    if (!handler) {
      this.handlers.delete(key);
    } else {
      this.handlers.get(key)?.delete(handler as EventHandler);
    }
    return this;
  }

  emit<E extends keyof ClientToServerEvents>(
    event: E | string,
    ...args: unknown[]
  ) {
    const key = String(event);
    const last = args[args.length - 1];
    if (typeof last === "function") {
      const cb = last as (result?: unknown) => void;
      const data = args.slice(0, -1);
      window.cmux
        .rpc(key, ...data)
        .then((res: unknown) => cb(res))
        .catch((err: unknown) => {
          const message = formatRpcErrorMessage(key, err);
          console.error("[CmuxIpcSocketClient] RPC error", { event: key, err });
          cb({ error: message });
        });
    } else {
      void window.cmux.rpc(key, ...args);
    }
    return this;
  }

  private trigger(event: string, ...args: unknown[]) {
    const set = this.handlers.get(event);
    if (!set) return;
    set.forEach((fn) => fn(...args));
  }
}

// Narrow type cast to satisfy consumers expecting a Socket.IO-like API
// No additional exported types needed; consumers cast to their desired socket type.
