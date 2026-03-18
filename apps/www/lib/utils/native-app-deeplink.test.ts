import { describe, expect, it } from "vitest";
import { buildNativeAppHref, isAllowedNativeAppHref } from "./native-app-deeplink";

describe("nativeAppDeeplink", () => {
  it("allows the production cmux auth callback", () => {
    expect(isAllowedNativeAppHref("cmux://auth-callback")).toBe(true);
  });

  it("allows tagged debug cmux callback schemes", () => {
    expect(isAllowedNativeAppHref("cmux-dev-auth-mobile://auth-callback")).toBe(true);
  });

  it("rejects unrelated native schemes", () => {
    expect(isAllowedNativeAppHref("evil://auth-callback")).toBe(false);
  });

  it("appends fresh Stack tokens to the callback URL", () => {
    expect(
      buildNativeAppHref(
        "cmux://auth-callback",
        "refresh-token",
        "[\"refresh-token\",\"access-token\"]",
      ),
    ).toBe(
      "cmux://auth-callback?stack_refresh=refresh-token&stack_access=%5B%22refresh-token%22%2C%22access-token%22%5D",
    );
  });
});
