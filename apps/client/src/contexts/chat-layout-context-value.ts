import { createContext } from "react";

export type ChatLayoutVariant =
  | "classic"
  | "minimal"
  | "bubble"
  | "terminal"
  | "notion";

export type ChatLayoutContextValue = {
  variant: ChatLayoutVariant;
  setVariant: (variant: ChatLayoutVariant) => void;
  variants: ChatLayoutVariant[];
  getLabel: (variant: ChatLayoutVariant) => string;
};

export const ChatLayoutContext = createContext<ChatLayoutContextValue | null>(null);
