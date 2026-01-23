import { ensureIframeFocusGuard } from "./iframeFocusGuard";

// Extend the Element interface to include moveBefore
declare global {
  interface Element {
    moveBefore?(node: Node, child: Node | null): void;
  }
}

type IframeEntry = {
  iframe: HTMLIFrameElement;
  wrapper: HTMLDivElement;
  url: string;
  lastUsed: number;
  isVisible: boolean;
  pinned: boolean;
  allow?: string;
  sandbox?: string;
  isStabilized: boolean; // Tracks if the iframe has completed initial stabilization
};

interface MountOptions {
  className?: string;
  style?: React.CSSProperties;
  allow?: string;
  sandbox?: string;
}

const UNITLESS_CSS_PROPERTIES = new Set<string>([
  "animation-iteration-count",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-negative",
  "flex-order",
  "flex-positive",
  "flex-shrink",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "font-weight",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
]);

/**
 * PersistentIframeManager uses a different approach:
 * - All iframes stay in a persistent container
 * - We use CSS to position them over the target container
 * - This avoids DOM moves entirely, preventing reload
 */
class PersistentIframeManager {
  private iframes = new Map<string, IframeEntry>();
  private maxIframes = 10;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver;
  private debugMode = false;
  private syncTimeouts = new Map<string, number>();

  constructor() {
    // Create resize observer for syncing positions
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const key = entry.target.getAttribute("data-iframe-target");
        if (key) {
          if (this.debugMode) {
            console.log(`[ResizeObserver] Syncing position for ${key}`);
          }
          this.syncIframePosition(key);
        }
      }
    });

    this.initializeContainer();
  }

  private initializeContainer() {
    if (typeof document === "undefined") return;

    ensureIframeFocusGuard();

    const init = () => {
      this.container = document.createElement("div");
      this.container.id = "persistent-iframe-container";
      this.container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        pointer-events: none;
        z-index: var(--z-persistent-iframe-container);
        isolation: isolate;
      `;
      document.body.appendChild(this.container);
    };

    if (document.body) {
      init();
    } else {
      document.addEventListener("DOMContentLoaded", init);
    }
  }

  /**
   * Get or create an iframe
   */
  getOrCreateIframe(
    key: string,
    url: string,
    options?: { allow?: string; sandbox?: string }
  ): HTMLIFrameElement {
    const existing = this.iframes.get(key);

    if (existing) {
      existing.lastUsed = Date.now();
      if (options?.allow !== undefined && existing.allow !== options.allow) {
        existing.iframe.allow = options.allow;
        existing.allow = options.allow;
      }
      if (
        options?.sandbox !== undefined &&
        existing.sandbox !== options.sandbox
      ) {
        existing.iframe.setAttribute("sandbox", options.sandbox);
        existing.sandbox = options.sandbox;
      }
      if (existing.url !== url) {
        existing.iframe.src = url;
        existing.url = url;
      }
      return existing.iframe;
    }

    // Create wrapper div
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      visibility: hidden;
      pointer-events: none;
      overflow: hidden;
      transform: translate(-100vw, -100vh);
      width: 100vw;
      height: 100vh;
      backface-visibility: hidden;
      z-index: var(--z-iframe);
      isolation: isolate;
      will-change: transform, opacity;
      opacity: 0;
      transition: opacity 50ms ease-out;
      contain: strict;
    `;
    wrapper.setAttribute("data-iframe-key", key);
    wrapper.setAttribute("data-drag-disable-pointer", "");

    // Create iframe
    const iframe = document.createElement("iframe");
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--background);
      display: block;
    `;

    // Apply permissions if provided
    if (options?.allow) {
      iframe.allow = options.allow;
    }

    // Apply sandbox if provided
    if (options?.sandbox) {
      iframe.setAttribute("sandbox", options.sandbox);
    }

    iframe.src = url;

    wrapper.appendChild(iframe);

    // Add to container
    if (this.container) {
      this.container.appendChild(wrapper);
    }

    const entry: IframeEntry = {
      iframe,
      wrapper,
      url,
      lastUsed: Date.now(),
      isVisible: false,
      pinned: false,
      allow: options?.allow,
      sandbox: options?.sandbox,
      isStabilized: false,
    };

    this.iframes.set(key, entry);
    this.moveIframeOffscreen(entry);
    this.cleanupOldIframes();

    return iframe;
  }

  /**
   * Show iframe over a target element
   */
  mountIframe(
    key: string,
    targetElement: HTMLElement,
    options?: MountOptions
  ): () => void {
    if (this.debugMode) console.log(`[Mount] Starting mount for ${key}`);

    const entry = this.iframes.get(key);
    if (!entry) {
      throw new Error(`Iframe with key "${key}" not found`);
    }

    // Mark target element
    targetElement.setAttribute("data-iframe-target", key);

    // Apply styles to wrapper
    if (options?.className) {
      entry.wrapper.className = options.className;
    }

    // First sync position while hidden (synchronously to avoid flash)
    this.syncIframePositionImmediate(key);

    entry.lastUsed = Date.now();

    // Use double-RAF to ensure position is painted before showing
    // This prevents the flash of the iframe at the wrong position
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Re-check entry still exists after async delay
        const currentEntry = this.iframes.get(key);
        if (!currentEntry) return;

        // Apply base styles without clobbering layout-related properties (width/height/transform)
        currentEntry.wrapper.style.position = "fixed";
        currentEntry.wrapper.style.top = "0";
        currentEntry.wrapper.style.left = "0";
        currentEntry.wrapper.style.right = "";
        currentEntry.wrapper.style.bottom = "";
        currentEntry.wrapper.style.visibility = "visible";
        currentEntry.wrapper.style.pointerEvents = "auto";
        currentEntry.wrapper.style.overflow = "hidden";
        currentEntry.wrapper.style.backfaceVisibility = "hidden";
        currentEntry.wrapper.style.willChange = "transform, opacity";
        currentEntry.wrapper.style.contain = "strict";

        // Apply custom styles (including z-index if provided)
        if (options?.style) {
          for (const [styleKey, styleValue] of Object.entries(options.style)) {
            if (styleValue === undefined || styleValue === null) {
              continue;
            }

            const cssKey = styleKey.replace(
              /[A-Z]/g,
              (match) => `-${match.toLowerCase()}`
            );
            const cssValue =
              typeof styleValue === "number" &&
              !UNITLESS_CSS_PROPERTIES.has(cssKey)
                ? `${styleValue}px`
                : String(styleValue);
            currentEntry.wrapper.style.setProperty(cssKey, cssValue);
          }
        }

        // Set default z-index if not provided in options
        if (!options?.style?.zIndex) {
          currentEntry.wrapper.style.zIndex = "var(--z-iframe)";
          currentEntry.wrapper.style.isolation = "isolate";
        }

        // Ensure position is synced before revealing
        this.syncIframePositionImmediate(key);

        // Fade in with opacity transition (smoother than visibility toggle)
        currentEntry.wrapper.style.opacity = "1";
        currentEntry.isVisible = true;
        currentEntry.isStabilized = true;

        if (this.debugMode) console.log(`[Mount] Iframe ${key} is now visible`);
      });
    });

    // Start observing the target element
    this.resizeObserver.observe(targetElement);

    // Throttled scroll handler to prevent excessive syncing
    let scrollRafId: number | null = null;
    const scrollHandler = () => {
      if (scrollRafId !== null) return; // Already scheduled
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        if (this.debugMode) console.log(`[Scroll] Syncing position for ${key}`);
        this.syncIframePosition(key);
      });
    };
    const scrollableParents = this.getScrollableParents(targetElement);
    scrollableParents.forEach((parent) => {
      parent.addEventListener("scroll", scrollHandler, { passive: true });
    });

    // Also sync on window resize
    window.addEventListener("resize", scrollHandler);

    // Return cleanup function
    return () => {
      if (this.debugMode) console.log(`[Unmount] Starting unmount for ${key}`);

      // Cancel any pending scroll RAF
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
      }

      targetElement.removeAttribute("data-iframe-target");
      // Use opacity fade-out instead of abrupt visibility change
      entry.wrapper.style.opacity = "0";
      entry.wrapper.style.pointerEvents = "none";
      entry.isVisible = false;
      // Delay hiding to allow opacity transition
      setTimeout(() => {
        if (!entry.isVisible) {
          entry.wrapper.style.visibility = "hidden";
        }
      }, 50);

      this.resizeObserver.unobserve(targetElement);
      scrollableParents.forEach((parent) => {
        parent.removeEventListener("scroll", scrollHandler);
      });
      window.removeEventListener("resize", scrollHandler);
    };
  }

  /**
   * Sync iframe position with target element (batched via RAF)
   */
  private syncIframePosition(key: string) {
    const entry = this.iframes.get(key);
    if (!entry) return;

    // Use requestAnimationFrame to batch position updates and prevent flashing
    const existingTimeout = this.syncTimeouts.get(key);
    if (existingTimeout !== undefined) {
      cancelAnimationFrame(existingTimeout);
    }

    const rafId = requestAnimationFrame(() => {
      this.syncTimeouts.delete(key);
      this.syncIframePositionImmediate(key);
    });

    this.syncTimeouts.set(key, rafId);
  }

  /**
   * Sync iframe position immediately (synchronous, for initial mount)
   */
  private syncIframePositionImmediate(key: string) {
    const entry = this.iframes.get(key);
    if (!entry) return;

    const targetElement = document.querySelector(
      `[data-iframe-target="${key}"]`
    );
    if (!targetElement || !(targetElement instanceof HTMLElement)) {
      this.moveIframeOffscreen(entry);
      return;
    }

    const rect = targetElement.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(targetElement);

    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
    const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;

    const width = Math.max(0, rect.width - borderLeft - borderRight);
    const height = Math.max(0, rect.height - borderTop - borderBottom);

    if (width < 1 || height < 1) {
      this.moveIframeOffscreen(entry);
      return;
    }

    // Update wrapper position using transform, keeping resize handles unobstructed
    entry.wrapper.style.transform = `translate(${rect.left + borderLeft}px, ${rect.top + borderTop}px)`;
    entry.wrapper.style.width = `${width}px`;
    entry.wrapper.style.height = `${height}px`;
  }

  /**
   * Get all scrollable parent elements
   */
  private getScrollableParents(element: HTMLElement): HTMLElement[] {
    const parents: HTMLElement[] = [];
    let current = element.parentElement;

    while (current) {
      const style = window.getComputedStyle(current);
      if (
        style.overflow === "auto" ||
        style.overflow === "scroll" ||
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      ) {
        parents.push(current);
      }
      current = current.parentElement;
    }

    // Always include window
    parents.push(document.documentElement);

    return parents;
  }

  /**
   * Hide iframe
   */
  unmountIframe(key: string): void {
    const entry = this.iframes.get(key);
    if (!entry) return;

    // Cancel any pending sync
    const syncTimeout = this.syncTimeouts.get(key);
    if (syncTimeout !== undefined) {
      cancelAnimationFrame(syncTimeout);
      this.syncTimeouts.delete(key);
    }

    // Fade out with opacity transition
    entry.wrapper.style.opacity = "0";
    entry.wrapper.style.pointerEvents = "none";
    entry.isVisible = false;

    // Delay full hide to allow opacity transition, then move offscreen
    setTimeout(() => {
      if (!entry.isVisible) {
        entry.wrapper.style.visibility = "hidden";
        this.moveIframeOffscreen(entry);
      }
    }, 50);
  }

  /**
   * Preload an iframe
   */
  preloadIframe(
    key: string,
    url: string,
    options?: { allow?: string; sandbox?: string }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const iframe = this.getOrCreateIframe(key, url, options);

      const handleLoad = () => {
        iframe.removeEventListener("load", handleLoad);
        iframe.removeEventListener("error", handleError);
        resolve();
      };

      const handleError = () => {
        iframe.removeEventListener("load", handleLoad);
        iframe.removeEventListener("error", handleError);
        reject(new Error(`Failed to load iframe: ${url}`));
      };

      if (iframe.contentWindow && iframe.src === url) {
        resolve();
        return;
      }

      iframe.addEventListener("load", handleLoad);
      iframe.addEventListener("error", handleError);
    });
  }

  /**
   * Remove an iframe completely
   */
  removeIframe(key: string): void {
    const entry = this.iframes.get(key);
    if (!entry) return;

    // Cancel any pending sync
    const syncTimeout = this.syncTimeouts.get(key);
    if (syncTimeout !== undefined) {
      cancelAnimationFrame(syncTimeout);
      this.syncTimeouts.delete(key);
    }

    if (entry.wrapper.parentElement) {
      entry.wrapper.parentElement.removeChild(entry.wrapper);
    }

    this.iframes.delete(key);
  }

  setPinned(key: string, pinned: boolean): void {
    const entry = this.iframes.get(key);
    if (!entry) {
      return;
    }
    entry.pinned = pinned;
    this.cleanupOldIframes();
  }

  /**
   * Clean up old iframes
   * More conservative cleanup: never remove pinned iframes, prioritize keeping stabilized ones
   */
  private cleanupOldIframes(): void {
    if (this.iframes.size <= this.maxIframes) return;

    const sorted = Array.from(this.iframes.entries())
      // Never remove visible or pinned iframes
      .filter(([, entry]) => !entry.isVisible && !entry.pinned)
      .sort(([, a], [, b]) => {
        // Prioritize keeping stabilized (fully loaded) iframes
        if (a.isStabilized !== b.isStabilized) {
          return a.isStabilized ? 1 : -1;
        }
        // Then sort by last used time
        return a.lastUsed - b.lastUsed;
      });

    const toRemove = sorted.slice(
      0,
      Math.max(0, this.iframes.size - this.maxIframes)
    );

    for (const [key] of toRemove) {
      this.removeIframe(key);
    }
  }

  /**
   * Preload multiple iframes
   */
  async preloadMultiple(
    entries: Array<{
      key: string;
      url: string;
      allow?: string;
      sandbox?: string;
    }>
  ): Promise<void> {
    await Promise.all(
      entries.map(({ key, url, allow, sandbox }) =>
        this.preloadIframe(key, url, { allow, sandbox })
      )
    );
  }

  /**
   * Get all loaded iframe keys
   */
  getLoadedKeys(): string[] {
    return Array.from(this.iframes.keys());
  }

  /**
   * Clear all iframes
   */
  clear(): void {
    // Cancel all pending syncs
    for (const rafId of this.syncTimeouts.values()) {
      cancelAnimationFrame(rafId);
    }
    this.syncTimeouts.clear();

    for (const key of this.iframes.keys()) {
      this.removeIframe(key);
    }
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  private moveIframeOffscreen(entry: IframeEntry): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const viewportWidth = Math.max(
      1,
      window.innerWidth || 0,
      document.documentElement?.clientWidth ?? 0
    );
    const viewportHeight = Math.max(
      1,
      window.innerHeight || 0,
      document.documentElement?.clientHeight ?? 0
    );

    entry.wrapper.style.width = `${viewportWidth}px`;
    entry.wrapper.style.height = `${viewportHeight}px`;
    entry.wrapper.style.transform = `translate(-${viewportWidth}px, -${viewportHeight}px)`;
    entry.wrapper.style.opacity = "0";
    entry.isStabilized = false;
  }

  isIframeFocused(key: string): boolean {
    if (typeof document === "undefined") {
      return false;
    }

    const entry = this.iframes.get(key);
    if (!entry || !entry.isVisible) return false;

    return document.activeElement === entry.iframe;
  }

  focusIframe(key: string): boolean {
    const entry = this.iframes.get(key);
    if (!entry) return false;

    const isHidden =
      entry.wrapper.style.visibility === "hidden" ||
      entry.wrapper.style.pointerEvents === "none";

    if (isHidden) {
      return false;
    }

    try {
      entry.iframe.focus();
      entry.iframe.contentWindow?.focus();
      return true;
    } catch (error) {
      console.error(`Failed to focus iframe "${key}"`, error);
      return false;
    }
  }

  reloadIframe(key: string): boolean {
    const entry = this.iframes.get(key);
    if (!entry) return false;

    try {
      entry.iframe.src = entry.url;
      return true;
    } catch (error) {
      console.error(`Failed to reload iframe "${key}"`, error);
      return false;
    }
  }
}

// Export singleton instance
export const persistentIframeManager = new PersistentIframeManager();
