export const getIsElectron = () => {
  // Only return true if running in the cmux Electron app with proper IPC bridge.
  // We explicitly check for the cmux-specific IPC methods to avoid false positives
  // in other Electron apps (like Cursor's embedded browser).
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      cmux?: { register?: unknown; rpc?: unknown; on?: unknown };
    };
    // Check that cmux has the required IPC methods from the preload script
    if (
      w.cmux &&
      typeof w.cmux.register === "function" &&
      typeof w.cmux.rpc === "function" &&
      typeof w.cmux.on === "function"
    ) {
      return true;
    }
  }

  return false;
};
export const isElectron = getIsElectron();
