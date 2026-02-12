import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { computeSetAsDefaultProtocolClientCall } from "./protocol-registration";

describe("computeSetAsDefaultProtocolClientCall", () => {
  it("returns simple registration when not running as default app", () => {
    const call = computeSetAsDefaultProtocolClientCall({
      scheme: "cmux",
      defaultApp: false,
      execPath: "/Electron",
      argv: ["/Electron", "/path/to/app"],
    });
    expect(call).toEqual({ kind: "simple", scheme: "cmux" });
  });

  it("returns withArgs registration for default app using argv[1] app path", () => {
    const call = computeSetAsDefaultProtocolClientCall({
      scheme: "cmux",
      defaultApp: true,
      execPath: "/Electron",
      argv: ["/Electron", "some/app/path", "--foo"],
    });
    expect(call).toEqual({
      kind: "withArgs",
      scheme: "cmux",
      execPath: "/Electron",
      args: [resolve("some/app/path")],
    });
  });

  it("skips flags and URLs when searching argv for app path", () => {
    const call = computeSetAsDefaultProtocolClientCall({
      scheme: "cmux",
      defaultApp: true,
      execPath: "/Electron",
      argv: ["/Electron", "--inspect=0", "apps/client", "cmux://auth-callback?a=b"],
    });
    expect(call).toEqual({
      kind: "withArgs",
      scheme: "cmux",
      execPath: "/Electron",
      args: [resolve("apps/client")],
    });
  });

  it("falls back to simple registration when no app path is present", () => {
    const call = computeSetAsDefaultProtocolClientCall({
      scheme: "cmux",
      defaultApp: true,
      execPath: "/Electron",
      argv: ["/Electron", "--inspect=0", "cmux://auth-callback?a=b"],
    });
    expect(call).toEqual({ kind: "simple", scheme: "cmux" });
  });
});

