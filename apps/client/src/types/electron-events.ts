export const ELECTRON_WINDOW_FOCUS_EVENT = "window-focus" as const;

export interface ElectronWindowFocusEventPayload {
  windowId: number;
}

export interface ElectronRendererEventMap {
  [ELECTRON_WINDOW_FOCUS_EVENT]: ElectronWindowFocusEventPayload;
}
