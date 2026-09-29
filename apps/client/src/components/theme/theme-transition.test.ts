import { describe, expect, it } from "vitest";

import {
  settleThemeViewTransition,
  shouldStartThemeViewTransition,
} from "./theme-transition";

describe("theme view transitions", () => {
  it("does not start a transition while the document is hidden", () => {
    expect(
      shouldStartThemeViewTransition({
        withTransition: true,
        prefersReducedMotion: false,
        visibilityState: "hidden",
        hasViewTransitionAPI: true,
      }),
    ).toBe(false);
  });

  it("observes rejected transition promises without rethrowing", async () => {
    const rejected = Promise.reject(
      new DOMException(
        "Transition was aborted because of invalid state",
        "InvalidStateError",
      ),
    );

    await expect(
      settleThemeViewTransition({
        ready: rejected,
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
      }),
    ).resolves.toBeUndefined();
  });
});
