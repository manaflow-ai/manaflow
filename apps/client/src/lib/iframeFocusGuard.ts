let focusGuardInitialized = false;
let lastActiveElement: Element | null = null;

const isFocusableElement = (
  element: Element | null
): element is HTMLElement | SVGElement => {
  return Boolean(
    element &&
      "focus" in element &&
      typeof (element as HTMLElement | SVGElement).focus === "function"
  );
};

const hasVisibleAncestors = (element: Element): boolean => {
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    if (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none"
      ) {
        return false;
      }
    }

    current = current.parentElement;
  }

  return true;
};

const isIframeVisibleOnScreen = (iframe: HTMLIFrameElement): boolean => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return true;
  }

  if (!iframe.isConnected) {
    return false;
  }

  const style = window.getComputedStyle(iframe);
  if (
    style.visibility === "hidden" ||
    style.display === "none" ||
    style.pointerEvents === "none"
  ) {
    return false;
  }

  if (!hasVisibleAncestors(iframe)) {
    return false;
  }

  if (iframe.getClientRects().length === 0) {
    return false;
  }

  const rect = iframe.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;

  const horizontallyVisible = rect.right > 0 && rect.left < viewportWidth;
  const verticallyVisible = rect.bottom > 0 && rect.top < viewportHeight;

  return horizontallyVisible && verticallyVisible;
};

export const ensureIframeFocusGuard = (): void => {
  if (focusGuardInitialized || typeof document === "undefined") {
    return;
  }

  focusGuardInitialized = true;
  lastActiveElement = document.activeElement;

  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target instanceof HTMLIFrameElement) {
      if (!isIframeVisibleOnScreen(target)) {
        const previousElement = lastActiveElement;

        if (isFocusableElement(previousElement)) {
          try {
            previousElement.focus({ preventScroll: true });
          } catch (error) {
            console.error(
              "Failed to restore focus after blocked iframe focus attempt",
              error
            );
          }
        }

        const activeElement = document.activeElement;
        lastActiveElement =
          activeElement instanceof Element
            ? activeElement
            : previousElement ?? null;
        return;
      }

      lastActiveElement = target;
      return;
    }

    lastActiveElement = target;
  };

  document.addEventListener("focusin", handleFocusIn, true);
};
