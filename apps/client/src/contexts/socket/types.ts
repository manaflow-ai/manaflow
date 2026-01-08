import type {
  AvailableEditors,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@cmux/shared";
import type { Socket } from "socket.io-client";

export type CmuxSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export interface SocketContextType {
  socket: CmuxSocket | null;
  isConnected: boolean;
  availableEditors: AvailableEditors | null;
}
