import { describe, expect, it } from "vitest";
import { parseTailscaleStatus, trimTailscaleHostname } from "./mobile-machine-info";

describe("mobile-machine-info", () => {
  it("trims trailing dots from tailscale hostnames", () => {
    expect(trimTailscaleHostname("cmux-macmini.tail.ts.net.")).toBe(
      "cmux-macmini.tail.ts.net",
    );
    expect(trimTailscaleHostname("")).toBeUndefined();
  });

  it("parses running tailscale status output", () => {
    const status = parseTailscaleStatus(
      JSON.stringify({
        BackendState: "Running",
        Self: {
          HostName: "Mac mini",
          DNSName: "cmux-macmini.tail.ts.net.",
          TailscaleIPs: ["100.64.0.10", "fd7a:115c:a1e0::10"],
        },
      }),
    );

    expect(status.running).toBe(true);
    expect(status.displayName).toBe("Mac mini");
    expect(status.tailscaleHostname).toBe("cmux-macmini.tail.ts.net");
    expect(status.tailscaleIPs).toEqual([
      "100.64.0.10",
      "fd7a:115c:a1e0::10",
    ]);
  });

  it("keeps tailscale fields empty when the backend is not running", () => {
    const status = parseTailscaleStatus(
      JSON.stringify({
        BackendState: "Stopped",
        Self: {
          HostName: "Mac mini",
          DNSName: "cmux-macmini.tail.ts.net.",
          TailscaleIPs: ["100.64.0.10"],
        },
      }),
    );

    expect(status.running).toBe(false);
    expect(status.tailscaleHostname).toBe("cmux-macmini.tail.ts.net");
    expect(status.tailscaleIPs).toEqual(["100.64.0.10"]);
  });
});
