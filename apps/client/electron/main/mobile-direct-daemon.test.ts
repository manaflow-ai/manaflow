import { describe, expect, it } from "vitest";
import forge from "node-forge";
import {
  buildSelfSignedDirectDaemonCertificate,
  normalizeDirectDaemonHosts,
  resolveCmuxdRemoteBinaryPath,
} from "./mobile-direct-daemon";

describe("mobile-direct-daemon", () => {
  it("normalizes and deduplicates certificate hosts", () => {
    expect(
      normalizeDirectDaemonHosts([
        " cmux-macmini.tail.ts.net. ",
        "cmux-macmini.tail.ts.net",
        "",
        undefined,
        "100.64.0.10",
      ]),
    ).toEqual(["cmux-macmini.tail.ts.net", "100.64.0.10"]);
  });

  it("builds a self-signed certificate with a stable sha256 pin", () => {
    const bundle = buildSelfSignedDirectDaemonCertificate([
      "cmux-macmini.tail.ts.net",
      "100.64.0.10",
    ]);
    const certificate = forge.pki.certificateFromPem(bundle.certPem);
    const subjectAltName = certificate.getExtension("subjectAltName");
    const altNameEntries =
      subjectAltName && "altNames" in subjectAltName
        ? (subjectAltName.altNames as Array<{ type: number; ip?: string; value?: string }>)
        : [];
    const altNames =
      altNameEntries
        .map((value) => (value.type === 7 ? value.ip : value.value))
        .filter((value): value is string => typeof value === "string");

    expect(bundle.pin).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(altNames).toContain("cmux-macmini.tail.ts.net");
    expect(altNames).toContain("100.64.0.10");
  });

  it("prefers the env override when resolving the cmuxd-remote binary", () => {
    process.env.CMUXD_REMOTE_PATH = "/tmp/cmuxd-remote";

    const resolved = resolveCmuxdRemoteBinaryPath({
      existsSync: (value) => value === "/tmp/cmuxd-remote",
    });

    expect(resolved).toBe("/tmp/cmuxd-remote");
    delete process.env.CMUXD_REMOTE_PATH;
  });
});
