import type { ClientToServerEvents, ServerToClientEvents } from "@cmux/shared";

// Timeout for pending callbacks (30 seconds)
const CALLBACK_TIMEOUT_MS = 30_000;

// IPC Socket client that mimics Socket.IO API but uses Electron IPC
export class IPCSocketClient {
  private socketId?: string;
  private eventHandlers: Map<string, Set<(...args: unknown[]) => void>> =
    new Map();
  private _connected = false;
  private disposed = false;
  private eventCleanup?: () => void;

  // Socket.IO compatibility properties
  public id = "";
  public connected = false;
  public disconnected = true;

  constructor(private query: Record<string, string>) {}

  connect() {
    if (this._connected || this.disposed) return this;

    // Connect via IPC
    window.cmux.socket
      .connect(this.query)
      .then((result) => {
        if (this.disposed) return;

        this.socketId = result.socketId;
        this._connected = true;
        this.connected = true;
        this.disconnected = false;
        this.id = result.socketId;

        // Setup event listener for server events
        this.eventCleanup = window.cmux.socket.onEvent(
          this.socketId,
          (eventName: string, ...args: unknown[]) => {
            if (this.disposed) return;

            // Handle acknowledgment callbacks
            if (eventName.startsWith("ack:")) {
              const callbackId = eventName.slice(4);
              const entry = this.pendingCallbacks.get(callbackId);
              if (entry) {
                clearTimeout(entry.timeoutId);
                entry.handler(args[0]);
                this.pendingCallbacks.delete(callbackId);
              }
              return;
            }

            // Handle regular events
            const handlers = this.eventHandlers.get(eventName);
            if (handlers) {
              handlers.forEach((handler) => handler(...args));
            }
          }
        );

        // Emit connect event
        this.triggerEvent("connect");
      })
      .catch((error) => {
        console.error("[IPCSocket] Connection failed:", error);
        this.triggerEvent("connect_error", error);
      });

    return this;
  }

  disconnect() {
    if (this.disposed) return this;
    this.disposed = true;

    if (this.socketId) {
      window.cmux.socket.disconnect(this.socketId);
    }

    this._connected = false;
    this.connected = false;
    this.disconnected = true;

    // Clean up event listener
    if (this.eventCleanup) {
      try {
        this.eventCleanup();
      } catch {
        // Ignore cleanup errors
      }
      this.eventCleanup = undefined;
    }

    // Clear all pending callbacks with their timeouts
    for (const entry of this.pendingCallbacks.values()) {
      clearTimeout(entry.timeoutId);
    }
    this.pendingCallbacks.clear();

    // Clear event handlers
    this.eventHandlers.clear();

    this.triggerEvent("disconnect");

    return this;
  }

  on<E extends keyof ServerToClientEvents>(
    event: E | string,
    handler: ServerToClientEvents[E] | ((...args: unknown[]) => void)
  ): this {
    if (!this.eventHandlers.has(event as string)) {
      this.eventHandlers.set(event as string, new Set());
    }
    this.eventHandlers
      .get(event as string)!
      .add(handler as (...args: unknown[]) => void);

    // Register with server if connected
    if (this._connected && this.socketId) {
      window.cmux.socket.on(this.socketId, event as string);
    }

    return this;
  }

  once<E extends keyof ServerToClientEvents>(
    event: E | string,
    handler: ServerToClientEvents[E] | ((...args: unknown[]) => void)
  ): this {
    const wrappedHandler = (...args: unknown[]) => {
      (handler as (...args: unknown[]) => void)(...args);
      this.off(event, wrappedHandler);
    };
    return this.on(event, wrappedHandler);
  }

  off<E extends keyof ServerToClientEvents>(
    event?: E | string,
    handler?: ServerToClientEvents[E] | ((...args: unknown[]) => void)
  ): this {
    if (!event) {
      this.eventHandlers.clear();
      return this;
    }

    if (!handler) {
      this.eventHandlers.delete(event as string);
      return this;
    }

    const handlers = this.eventHandlers.get(event as string);
    if (handlers) {
      handlers.delete(handler as (...args: unknown[]) => void);
    }

    return this;
  }

  private pendingCallbacks = new Map<
    string,
    { handler: (response: unknown) => void; timeoutId: ReturnType<typeof setTimeout> }
  >();

  emit<E extends keyof ClientToServerEvents>(
    event: E | string,
    ...args: unknown[]
  ): this {
    if (!this._connected || !this.socketId || this.disposed) {
      console.warn("[IPCSocket] Cannot emit - not connected");
      return this;
    }

    // Check if last argument is a callback
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      // Generate callback ID and store the callback with timeout
      const callbackId = `${Date.now()}_callback_${Math.random()}`;
      const handler = lastArg as (response: unknown) => void;

      // Set up timeout to clean up stale callbacks
      const timeoutId = setTimeout(() => {
        const entry = this.pendingCallbacks.get(callbackId);
        if (entry) {
          this.pendingCallbacks.delete(callbackId);
          console.warn(`[IPCSocket] Callback ${callbackId} timed out for event: ${String(event)}`);
        }
      }, CALLBACK_TIMEOUT_MS);

      this.pendingCallbacks.set(callbackId, { handler, timeoutId });

      // Replace callback with callback ID
      const argsWithCallback = [...args.slice(0, -1), callbackId];
      window.cmux.socket.emit(this.socketId, event as string, argsWithCallback);
    } else {
      // No callback, emit normally
      window.cmux.socket.emit(this.socketId, event as string, args);
    }

    return this;
  }

  private triggerEvent(event: string, ...args: unknown[]) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }
}
