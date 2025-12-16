import { describe, expect, it } from "vitest";
import { extractMorphInstanceInfo } from "./morph-instance";

describe("extractMorphInstanceInfo", () => {
  it("detects direct morph hosts", () => {
    const info = extractMorphInstanceInfo(
      "https://port-39378-morphvm-abc123.http.cloud.morph.so/?folder=/root/workspace"
    );
    expect(info).toEqual({
      hostname: "port-39378-morphvm-abc123.http.cloud.morph.so",
      morphId: "abc123",
      instanceId: "morphvm_abc123",
      port: 39378,
      source: "http-cloud",
    });
  });

  it("detects cmux proxy hosts", () => {
    const info = extractMorphInstanceInfo(
      "https://cmux-abc123-custom-scope-8101.cmux.app/"
    );
    expect(info).toEqual({
      hostname: "cmux-abc123-custom-scope-8101.cmux.app",
      morphId: "abc123",
      instanceId: "morphvm_abc123",
      port: 8101,
      source: "cmux-proxy",
    });
  });

  it("detects port rewrite hosts", () => {
    const info = extractMorphInstanceInfo(
      "https://port-9000-abc123.cmux.sh/path"
    );
    expect(info).toEqual({
      hostname: "port-9000-abc123.cmux.sh",
      morphId: "abc123",
      instanceId: "morphvm_abc123",
      port: 9000,
      source: "cmux-port",
    });
  });

  it("returns null for non-morph hosts", () => {
    expect(extractMorphInstanceInfo("https://example.com"))
      .toBeNull();
  });
});
