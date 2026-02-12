import { describe, expect, it } from "vitest";
import {
  buildStackAuthAccessCookieValue,
  buildStackAuthCookieSpecs,
  formatStackAuthStructuredRefreshCookieValue,
  getStackAuthRefreshBaseName,
  getStackAuthRefreshDefaultCookieName,
  isStackAuthCookieName,
  parseStackAuthStructuredRefreshCookieValue,
} from "./stack-auth-cookies";

describe("stack-auth-cookies", () => {
  it("builds the refresh base cookie name", () => {
    expect(getStackAuthRefreshBaseName("proj_123")).toBe("stack-refresh-proj_123");
  });

  it("builds the default refresh cookie name like Stack Auth SDK", () => {
    expect(getStackAuthRefreshDefaultCookieName("proj_123", true)).toBe(
      "__Host-stack-refresh-proj_123--default"
    );
    expect(getStackAuthRefreshDefaultCookieName("proj_123", false)).toBe(
      "stack-refresh-proj_123--default"
    );
  });

  it("formats and parses the structured refresh cookie value", () => {
    const value = formatStackAuthStructuredRefreshCookieValue("rtok", 123);
    const parsed = parseStackAuthStructuredRefreshCookieValue(value);
    expect(parsed).toEqual({ refreshToken: "rtok", updatedAtMillis: 123 });
  });

  it("returns null for non-structured refresh cookie values", () => {
    expect(parseStackAuthStructuredRefreshCookieValue("rtok")).toBeNull();
    expect(parseStackAuthStructuredRefreshCookieValue("")).toBeNull();
    expect(parseStackAuthStructuredRefreshCookieValue("[1,2]")).toBeNull();
  });

  it("builds stack-access cookie value from a JSON array param", () => {
    const refresh = "refreshA";
    const accessParam = JSON.stringify([refresh, "accessA"]);
    const out = buildStackAuthAccessCookieValue(refresh, accessParam);
    expect(out.accessCookieValue).toBe(JSON.stringify([refresh, "accessA"]));
    expect(out.accessToken).toBe("accessA");
  });

  it("builds stack-access cookie value from a raw access token param", () => {
    const refresh = "refreshB";
    const out = buildStackAuthAccessCookieValue(refresh, "accessB");
    expect(out.accessCookieValue).toBe(JSON.stringify([refresh, "accessB"]));
    expect(out.accessToken).toBe("accessB");
  });

  it("recognizes stack auth cookie names and variants", () => {
    expect(isStackAuthCookieName("stack-is-https", "proj")).toBe(true);
    expect(isStackAuthCookieName("stack-access", "proj")).toBe(true);
    expect(isStackAuthCookieName("__Host-stack-access", "proj")).toBe(true);
    expect(isStackAuthCookieName("stack-access--default", "proj")).toBe(true);
    expect(isStackAuthCookieName("__Secure-stack-access--default", "proj")).toBe(
      true
    );

    expect(isStackAuthCookieName("stack-refresh-proj", "proj")).toBe(true);
    expect(isStackAuthCookieName("__Host-stack-refresh-proj--default", "proj")).toBe(
      true
    );
    expect(isStackAuthCookieName("stack-refresh-proj--custom-xyz", "proj")).toBe(
      true
    );
    expect(isStackAuthCookieName("stack-refresh", "proj")).toBe(true);

    expect(isStackAuthCookieName("unrelated", "proj")).toBe(false);
    expect(isStackAuthCookieName("stack-refresh-other", "proj")).toBe(false);
  });

  it("builds cookie specs that are stable and self-consistent", () => {
    const specs = buildStackAuthCookieSpecs({
      projectId: "proj_123",
      refreshToken: "refreshTokenValue",
      stackAccessParam: JSON.stringify(["refreshTokenValue", "accessTokenValue"]),
      secure: true,
    });

    expect(specs.refresh.name).toBe("__Host-stack-refresh-proj_123--default");
    expect(specs.refresh.path).toBe("/");
    expect(specs.refresh.httpOnly).toBe(false);
    expect(specs.refresh.secure).toBe(true);
    expect(specs.refresh.sameSite).toBe("lax");
    expect(specs.refresh.maxAgeSeconds).toBe(60 * 60 * 24 * 365);

    const parsedRefresh = parseStackAuthStructuredRefreshCookieValue(specs.refresh.value);
    expect(parsedRefresh?.refreshToken).toBe("refreshTokenValue");
    expect(typeof parsedRefresh?.updatedAtMillis).toBe("number");

    expect(specs.access.name).toBe("stack-access");
    expect(specs.access.value).toBe(
      JSON.stringify(["refreshTokenValue", "accessTokenValue"])
    );
    expect(specs.access.maxAgeSeconds).toBe(60 * 60 * 24);

    expect(specs.isHttps.name).toBe("stack-is-https");
    expect(specs.isHttps.value).toBe("true");
  });
});

