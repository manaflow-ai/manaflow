import { useState, type ReactNode } from "react";
import {
  ChatLayoutContext,
  type ChatLayoutVariant,
} from "./chat-layout-context-value";

export type { ChatLayoutVariant, ChatLayoutContextValue } from "./chat-layout-context-value";

const variantLabels: Record<ChatLayoutVariant, string> = {
  classic: "Classic",
  minimal: "Minimal",
  bubble: "Bubble",
  terminal: "Terminal",
  notion: "Notion",
};

export function ChatLayoutProvider({ children }: { children: ReactNode }) {
  const [variant, setVariant] = useState<ChatLayoutVariant>(() => {
    if (typeof window === "undefined") return "notion";
    const stored = localStorage.getItem("chat-layout-variant");
    if (stored && stored in variantLabels) {
      return stored as ChatLayoutVariant;
    }
    return "notion";
  });

  const handleSetVariant = (next: ChatLayoutVariant) => {
    setVariant(next);
    localStorage.setItem("chat-layout-variant", next);
  };

  return (
    <ChatLayoutContext.Provider
      value={{
        variant,
        setVariant: handleSetVariant,
        variants: Object.keys(variantLabels) as ChatLayoutVariant[],
        getLabel: (v) => variantLabels[v],
      }}
    >
      {children}
    </ChatLayoutContext.Provider>
  );
}
