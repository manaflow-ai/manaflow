import { describe, expect, it } from "vitest";
import { deriveProxyRoute } from "./rust-preview-proxy-route";

describe("deriveProxyRoute", () => {
  it("derives route info from cmux proxy host", () => {
    const result = deriveProxyRoute(
      "https://cmux-abc-scope-39379.cmux.app/path",
      { morphDomainSuffix: "custom.domain" }
    );

    expect(result).toEqual({
      morphId: "abc",
      scope: "scope",
      domainSuffix: "cmux.app",
      morphDomainSuffix: ".custom.domain",
    });
  });

  it("detects direct morph vm host and captures suffix", () => {
    const result = deriveProxyRoute(
      "https://port-8101-morphvm-morph123.http.cloud.morph.so/"
    );

    expect(result).toEqual({
      morphId: "morph123",
      scope: "base",
      domainSuffix: "cmux.app",
      morphDomainSuffix: ".http.cloud.morph.so",
    });
  });

  it("returns null for unsupported hostnames", () => {
    expect(deriveProxyRoute("https://example.com")).toBeNull();
  });

  it("normalizes morph suffix overrides", () => {
    const result = deriveProxyRoute(
      "https://cmux-xyz-base-39378.cmux.dev",
      { morphDomainSuffix: "alt.morph" }
    );

    expect(result?.morphDomainSuffix).toBe(".alt.morph");
  });

  it("omits morph suffix when override is null", () => {
    const result = deriveProxyRoute(
      "https://cmux-xyz-base-39378.cmux.dev",
      { morphDomainSuffix: null }
    );

    expect(result?.morphDomainSuffix).toBeUndefined();
  });
});
