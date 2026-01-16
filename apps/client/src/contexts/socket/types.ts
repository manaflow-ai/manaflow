import type {
  AvailableEditors,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@cmux/shared";

type SocketEventHandler = (...args: unknown[]) => void;

export interface CmuxSocket {
  connected: boolean;
  disconnected: boolean;
  id?: string;
  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E]
  ): void;
  on(event: string, handler: SocketEventHandler): void;
  off<E extends keyof ServerToClientEvents>(
    event: E,
    handler?: ServerToClientEvents[E]
  ): void;
  off(event?: string, handler?: SocketEventHandler): void;
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void;
  emit(event: string, ...args: unknown[]): void;
  disconnect(): void;
}
export interface SocketContextType {
  socket: CmuxSocket | null;
  isConnected: boolean;
  availableEditors: AvailableEditors | null;
}
