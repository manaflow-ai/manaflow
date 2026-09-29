export type ProtocolWindowLike = {
  isDestroyed: () => boolean;
  readonly webContents: {
    isDestroyed: () => boolean;
  };
};

export function isProtocolWindowUsable<T extends ProtocolWindowLike>(
  window: T | null,
): window is T {
  if (!window || window.isDestroyed()) {
    return false;
  }
  return !window.webContents.isDestroyed();
}
