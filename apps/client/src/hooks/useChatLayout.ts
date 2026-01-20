import { useContext } from "react";
import { ChatLayoutContext } from "@/contexts/chat-layout-context-value";

export function useChatLayout() {
  const ctx = useContext(ChatLayoutContext);
  if (!ctx) {
    throw new Error("useChatLayout must be used within ChatLayoutProvider");
  }
  return ctx;
}
