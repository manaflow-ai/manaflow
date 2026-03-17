import type { CmuxSocket } from "./types";

type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
type RejectFn = (reason?: unknown) => void;

function withResolvers<T>() {
  let resolve!: ResolveFn<T>;
  let reject!: RejectFn;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createBootHandle() {
  let state = withResolvers<void>();
  return {
    get promise() {
      return state.promise;
    },
    resolve() {
      // Resolve is idempotent; extra calls are ignored by Promise machinery
      state.resolve();
    },
    reject(reason?: unknown) {
      state.reject(reason);
    },
    reset() {
      state = withResolvers<void>();
    },
  } as const;
}

export const socketBoot = createBootHandle();

// Global, HMR-safe socket state and waiters
type Waiter = {
  resolve: (sock: CmuxSocket) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

interface GlobalSocketState {
  socket: CmuxSocket | null;
  createdWaiters: Waiter[];
  connectedWaiters: Waiter[];
  listeningSocket: CmuxSocket | null;
  onConnect?: () => void;
}

declare global {
  var __cmuxSocketBoot: GlobalSocketState | undefined;
}

function getGlobalState(): GlobalSocketState {
  if (!globalThis.__cmuxSocketBoot) {
    globalThis.__cmuxSocketBoot = {
      socket: null,
      createdWaiters: [],
      connectedWaiters: [],
      listeningSocket: null,
    };
  }
  return globalThis.__cmuxSocketBoot;
}

function removeWaiter(list: Waiter[], w: Waiter) {
  const idx = list.indexOf(w);
  if (idx >= 0) list.splice(idx, 1);
}

function resolveCreatedWaiters(state: GlobalSocketState) {
  const sock = state.socket;
  if (!sock) return;
  const waiters = state.createdWaiters.splice(0);
  for (const w of waiters) {
    if (w.timer) clearTimeout(w.timer);
    w.resolve(sock);
  }
}

function resolveConnectedWaiters(state: GlobalSocketState) {
  const sock = state.socket;
  if (!sock) return;
  const waiters = state.connectedWaiters.splice(0);
  for (const w of waiters) {
    if (w.timer) clearTimeout(w.timer);
    w.resolve(sock);
  }
}

function ensureSocketListeners(state: GlobalSocketState) {
  const sock = state.socket;
  if (!sock) return;

  // Detach from previous socket if changed
  if (state.listeningSocket && state.listeningSocket !== sock) {
    if (state.onConnect) {
      state.listeningSocket.off("connect", state.onConnect);
    }
    state.listeningSocket = null;
    state.onConnect = undefined;
  }

  if (sock.connected) {
    resolveConnectedWaiters(state);
    return;
  }

  if (!state.onConnect) {
    state.onConnect = () => resolveConnectedWaiters(state);
    sock.on("connect", state.onConnect);
    state.listeningSocket = sock;
  }
}

export function setGlobalSocket(socket: CmuxSocket | null) {
  const state = getGlobalState();
  state.socket = socket;
  if (socket) {
    resolveCreatedWaiters(state);
    ensureSocketListeners(state);
  }
}

export function getGlobalSocket(): CmuxSocket | null {
  return getGlobalState().socket;
}

export async function waitForSocketCreated(
  timeoutMs = 15000
): Promise<CmuxSocket> {
  const state = getGlobalState();
  if (state.socket) return state.socket;
  return await new Promise<CmuxSocket>((resolve, reject) => {
    const w: Waiter = { resolve, reject };
    if (timeoutMs > 0) {
      w.timer = setTimeout(() => {
        removeWaiter(state.createdWaiters, w);
        reject(new Error("Socket creation timeout"));
      }, timeoutMs);
    }
    state.createdWaiters.push(w);
  });
}

// Retained for potential future use by call sites; not used internally now.
// intentionally empty of helpers to keep this module minimal

export async function waitForConnectedSocket(
  timeoutMs = 15000
): Promise<CmuxSocket> {
  const sock = await waitForSocketCreated(timeoutMs);
  if (sock.connected) return sock;
  const state = getGlobalState();
  return await new Promise<CmuxSocket>((resolve, reject) => {
    const w: Waiter = { resolve, reject };
    if (timeoutMs > 0) {
      w.timer = setTimeout(() => {
        removeWaiter(state.connectedWaiters, w);
        reject(new Error("Socket connect timeout"));
      }, timeoutMs);
    }
    state.connectedWaiters.push(w);
    ensureSocketListeners(state);
  });
}
