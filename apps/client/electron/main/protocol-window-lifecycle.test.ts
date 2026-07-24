import { describe, expect, it } from "vitest";

import { isProtocolWindowUsable } from "./protocol-window-lifecycle";

describe("isProtocolWindowUsable", () => {
  it("rejects a destroyed browser window before reading its web contents", () => {
    let webContentsRead = false;
    const window = {
      isDestroyed: () => true,
      get webContents() {
        webContentsRead = true;
        return { isDestroyed: () => false };
      },
    };

    expect(isProtocolWindowUsable(window)).toBe(false);
    expect(webContentsRead).toBe(false);
  });

  it("rejects destroyed web contents", () => {
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => true },
    };

    expect(isProtocolWindowUsable(window)).toBe(false);
  });

  it("accepts a live window with live web contents", () => {
    const window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false },
    };

    expect(isProtocolWindowUsable(window)).toBe(true);
  });
});
