type ThemeViewTransition = Pick<
  ViewTransition,
  "ready" | "updateCallbackDone" | "finished"
>;

type ThemeViewTransitionPolicy = {
  withTransition: boolean;
  prefersReducedMotion: boolean;
  visibilityState: DocumentVisibilityState;
  hasViewTransitionAPI: boolean;
};

export function shouldStartThemeViewTransition({
  withTransition,
  prefersReducedMotion,
  visibilityState,
  hasViewTransitionAPI,
}: ThemeViewTransitionPolicy): boolean {
  return (
    withTransition &&
    !prefersReducedMotion &&
    visibilityState === "visible" &&
    hasViewTransitionAPI
  );
}

export async function settleThemeViewTransition(
  transition: ThemeViewTransition,
): Promise<void> {
  const results = await Promise.allSettled([
    transition.ready,
    transition.updateCallbackDone,
    transition.finished,
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Theme view transition failed", result.reason);
    }
  }
}
