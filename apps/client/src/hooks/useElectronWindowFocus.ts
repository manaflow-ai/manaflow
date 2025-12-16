import { useEffect } from "react";

import { isElectron } from "@/lib/electron";
import {
  ELECTRON_WINDOW_FOCUS_EVENT,
  type ElectronRendererEventMap,
} from "@/types/electron-events";

type WindowFocusPayload =
  ElectronRendererEventMap[typeof ELECTRON_WINDOW_FOCUS_EVENT];

function isWindowFocusPayload(payload: unknown): payload is WindowFocusPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "windowId" in payload &&
    typeof (payload as { windowId?: unknown }).windowId === "number"
  );
}

export function useElectronWindowFocus(
  onFocus: (payload: WindowFocusPayload) => void
): void {
  useEffect(() => {
    if (!isElectron) return;
    if (typeof window === "undefined") return;
    const cmux = window.cmux;
    if (!cmux?.on) return;

    const handler = (payload: unknown) => {
      if (!isWindowFocusPayload(payload)) return;
      onFocus(payload);
    };

    const unsubscribe = cmux.on(ELECTRON_WINDOW_FOCUS_EVENT, handler);

    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.error("Failed to unsubscribe from Electron window focus", error);
      }
    };
  }, [onFocus]);
}
