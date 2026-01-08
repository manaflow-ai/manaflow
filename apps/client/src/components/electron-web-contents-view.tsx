import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  registerWebviewActions,
  unregisterWebviewActions,
  type WebviewActions,
} from "@/lib/webview-actions";
import { isElectron } from "@/lib/electron";
import { cn } from "@/lib/utils";

interface ElectronWebContentsViewProps {
  src: string;
  requestUrl?: string;
  className?: string;
  style?: CSSProperties;
  backgroundColor?: string;
  fallback?: ReactNode;
  borderRadius?: number;
  suspended?: boolean;
  persistKey?: string;
  retainOnUnmount?: boolean;
  onNativeViewReady?: (info: {
    id: number;
    webContentsId: number;
    restored: boolean;
  }) => void;
  onNativeViewDestroyed?: () => void;
}

function getWebContentsBridge() {
  if (typeof window === "undefined") return null;
  return window.cmux?.webContentsView ?? null;
}

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.log("[electron-web-contents-view]", message, payload ?? {});
  } else {
    console.log("[electron-web-contents-view]", message, payload ?? {});
  }
}

interface BoundsPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SyncState {
  bounds: BoundsPayload;
  visible: boolean;
  devicePixelRatio: number;
}

const CONTINUOUS_IDLE_FRAME_LIMIT = 6;
const PIXEL_RATIO_EPSILON = 1e-3;

function roundToDevicePixels(value: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return Math.round(value);
  return Math.round(value * scale) / scale;
}

function rectToBounds(rect: DOMRect, scale: number): BoundsPayload {
  return {
    x: roundToDevicePixels(rect.left, scale),
    y: roundToDevicePixels(rect.top, scale),
    width: Math.max(0, roundToDevicePixels(rect.width, scale)),
    height: Math.max(0, roundToDevicePixels(rect.height, scale)),
  };
}

function isEffectivelyHidden(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return true;
  }
  if (style.opacity === "0") {
    return true;
  }
  return false;
}

function hasActiveTransform(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.transform && style.transform !== "none") {
      return true;
    }
    if (style.perspective && style.perspective !== "none") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

type ScrollTarget = HTMLElement | Document | Window;

function isScrollable(
  element: HTMLElement,
  style: CSSStyleDeclaration,
): boolean {
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const canScrollY =
    (overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight;
  const canScrollX =
    (overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay") &&
    element.scrollWidth > element.clientWidth;
  return canScrollX || canScrollY;
}

function getScrollableAncestors(element: HTMLElement): ScrollTarget[] {
  const targets: ScrollTarget[] = [];
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (isScrollable(current, style)) {
      targets.push(current);
    }
    current = current.parentElement;
  }
  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement) {
    targets.push(scrollingElement);
  } else if (document.documentElement instanceof HTMLElement) {
    targets.push(document.documentElement);
  }
  targets.push(window);
  return targets;
}

const pendingReleases = new Map<string, Promise<void>>();
const pendingCreates = new Map<string, Promise<void>>();

export function ElectronWebContentsView({
  src,
  requestUrl,
  className,
  style,
  backgroundColor,
  fallback,
  borderRadius,
  suspended = false,
  persistKey,
  retainOnUnmount: _retainOnUnmount,
  onNativeViewReady,
  onNativeViewDestroyed,
}: ElectronWebContentsViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewIdRef = useRef<number | null>(null);
  const webContentsIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const continuousSyncRef = useRef<number | null>(null);
  const continuousActiveRef = useRef(false);
  const continuousStableFramesRef = useRef(0);
  const lastSyncRef = useRef<SyncState | null>(null);
  const syncBoundsRef = useRef<() => void>(() => {});
  const latestSrcRef = useRef(src);
  const latestRequestUrlRef = useRef(requestUrl);
  const lastLoadedSrcRef = useRef<string | null>(null);
  const latestStyleRef = useRef<{
    backgroundColor?: string;
    borderRadius?: number;
  }>({
    backgroundColor,
    borderRadius,
  });
  const hasStableAttachmentRef = useRef(false);
  const registeredActionsRef = useRef<WebviewActions | null>(null);
  const isIntersectingRef = useRef(true);
  const scrollCleanupsRef = useRef<Array<() => void>>([]);
  const lastTransformStateRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    latestSrcRef.current = src;
  }, [src]);

  useEffect(() => {
    latestRequestUrlRef.current = requestUrl;
  }, [requestUrl]);

  useEffect(() => {
    latestStyleRef.current = { backgroundColor, borderRadius };
  }, [backgroundColor, borderRadius]);

  const cancelScheduledSync = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopContinuousSync = useCallback(() => {
    if (continuousSyncRef.current !== null) {
      cancelAnimationFrame(continuousSyncRef.current);
      continuousSyncRef.current = null;
    }
    continuousActiveRef.current = false;
    continuousStableFramesRef.current = 0;
  }, []);

  const startContinuousSync = useCallback(() => {
    if (!isElectron) return;
    if (continuousSyncRef.current !== null) return;
    if (viewIdRef.current === null) return;
    if (continuousActiveRef.current) return;

    const tick = () => {
      continuousSyncRef.current = window.requestAnimationFrame(tick);
      syncBoundsRef.current();
    };

    continuousSyncRef.current = window.requestAnimationFrame(tick);
    continuousActiveRef.current = true;
    continuousStableFramesRef.current = 0;
    syncBoundsRef.current();
  }, []);

  const syncBounds = useCallback(() => {
    if (!isElectron) return;
    const bridge = getWebContentsBridge();
    const id = viewIdRef.current;
    const container = containerRef.current;
    if (!bridge || id === null || !container) return;

    const scale = window.devicePixelRatio ?? 1;
    const rect = container.getBoundingClientRect();
    const bounds = rectToBounds(rect, scale);
    const sizeMissing = bounds.width <= 0 || bounds.height <= 0;
    const hiddenByStyle = isEffectivelyHidden(container);
    const isVisible =
      !suspended && !sizeMissing && !hiddenByStyle && isIntersectingRef.current;

    const hasAnimations =
      typeof container.getAnimations === "function" &&
      container.getAnimations().length > 0;
    const shouldTrackTransforms =
      !suspended && (hasActiveTransform(container) || hasAnimations);
    if (shouldTrackTransforms !== lastTransformStateRef.current) {
      lastTransformStateRef.current = shouldTrackTransforms;
      if (shouldTrackTransforms) {
        startContinuousSync();
      } else {
        stopContinuousSync();
      }
    }

    const visible = isVisible;
    const prev = lastSyncRef.current;
    const pixelRatioUnchanged =
      prev !== null &&
      Math.abs(prev.devicePixelRatio - scale) < PIXEL_RATIO_EPSILON;
    const unchanged =
      prev !== null &&
      prev.visible === visible &&
      pixelRatioUnchanged &&
      prev.bounds.x === bounds.x &&
      prev.bounds.y === bounds.y &&
      prev.bounds.width === bounds.width &&
      prev.bounds.height === bounds.height;

    if (continuousActiveRef.current) {
      if (unchanged) {
        continuousStableFramesRef.current += 1;
        if (continuousStableFramesRef.current >= CONTINUOUS_IDLE_FRAME_LIMIT) {
          stopContinuousSync();
        }
      } else {
        continuousStableFramesRef.current = 0;
      }
    }

    if (unchanged) {
      return;
    }

    void bridge
      .setBounds({ id, bounds, visible })
      .catch((err) =>
        console.warn("Failed to sync WebContentsView bounds", err),
      );
    lastSyncRef.current = { bounds, visible, devicePixelRatio: scale };
  }, [suspended, startContinuousSync, stopContinuousSync]);

  syncBoundsRef.current = syncBounds;

  useEffect(() => {
    syncBoundsRef.current = syncBounds;
  }, [syncBounds]);

  const scheduleBoundsSync = useCallback(() => {
    if (!isElectron) return;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      syncBounds();
    });
  }, [syncBounds]);

  const persistKeyRef = useRef<string | undefined>(persistKey);

  persistKeyRef.current = persistKey;

  const unregisterActions = useCallback(() => {
    if (!persistKeyRef.current || !registeredActionsRef.current) {
      return;
    }
    unregisterWebviewActions(persistKeyRef.current, registeredActionsRef.current);
    registeredActionsRef.current = null;
  }, []);

  const registerActions = useCallback(
    (webContentsId: number) => {
      const key = persistKeyRef.current;
      if (!key) return;
      webContentsIdRef.current = webContentsId;
      const actions: WebviewActions = {
        focus: async () => {
          if (typeof window === "undefined") return false;

          const targetId = webContentsIdRef.current;
          if (targetId === null) return false;

          try {
            const restore = window.cmux?.ui?.restoreLastFocusInWebContents;
            if (restore) {
              const result = await restore(targetId);
              if (result?.ok) {
                return true;
              }
            }

            const focus = window.cmux?.ui?.focusWebContents;
            if (focus) {
              const result = await focus(targetId);
              return result?.ok ?? false;
            }
          } catch (error) {
            console.error("Failed to focus WebContentsView", error);
            return false;
          }

          return false;
        },
        isFocused: async () => {
          if (typeof window === "undefined") return false;

          const viewId = viewIdRef.current;
          if (viewId === null) return false;

          try {
            const checkFocus = window.cmux?.webContentsView?.isFocused;
            if (!checkFocus) return false;
            const result = await checkFocus(viewId);
            return result?.ok === true && result.focused === true;
          } catch (error) {
            console.error("Failed to check WebContentsView focus", error);
            return false;
          }
        },
      };
      registeredActionsRef.current = actions;
      registerWebviewActions(key, actions);
    },
    [],
  );

  useEffect(() => {
    return () => {
      unregisterActions();
      webContentsIdRef.current = null;
    };
  }, [unregisterActions]);

  const releaseNativeView = useCallback(
    (id: number, key: string | undefined) => {
      const bridge = getWebContentsBridge();
      if (!bridge) return;

      const persistKey =
        typeof key === "string" && key.length > 0 ? key : undefined;

      debugLog("release-native-view", {
        id,
        persistKey,
      });

      const releaseTask = (async () => {
        if (typeof bridge.release === "function") {
          try {
            debugLog("requesting-release", { id, persistKey });
            const result = await bridge.release({ id, persist: true });
            const succeeded = result?.ok === true && result?.suspended === true;
            if (succeeded) {
              debugLog("release-requested", { id, persistKey });
              return;
            }
            debugLog("release-declined", {
              id,
              persistKey,
              result,
            });
          } catch (err) {
            console.warn("Failed to release WebContentsView", err);
          }
        }

        try {
          debugLog("destroying-native-view", { id, persistKey });
          await bridge.destroy(id);
        } catch (err) {
          console.warn("Failed to destroy WebContentsView", err);
        }
      })();

      if (persistKey) {
        const tracked = releaseTask.finally(() => {
          if (pendingReleases.get(persistKey) === tracked) {
            pendingReleases.delete(persistKey);
          }
        });
        pendingReleases.set(persistKey, tracked);
        void tracked.catch(() => undefined);
      } else {
        void releaseTask.catch(() => undefined);
      }
    },
    [],
  );

  const releaseView = useCallback(() => {
    cancelScheduledSync();
    stopContinuousSync();
    unregisterActions();
    webContentsIdRef.current = null;
    const id = viewIdRef.current;
    if (id === null) return;
    viewIdRef.current = null;
    lastSyncRef.current = null;
    lastLoadedSrcRef.current = null;
    hasStableAttachmentRef.current = false;
    lastTransformStateRef.current = false;
    releaseNativeView(id, persistKeyRef.current);
    onNativeViewDestroyed?.();
  }, [
    cancelScheduledSync,
    unregisterActions,
    onNativeViewDestroyed,
    releaseNativeView,
    stopContinuousSync,
  ]);

  useEffect(() => {
    if (!isElectron) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const bridge = getWebContentsBridge();
    if (!bridge) return undefined;

    let disposed = false;
    setErrorMessage(null);

    const initialScale = window.devicePixelRatio ?? 1;
    const initialBounds = rectToBounds(
      container.getBoundingClientRect(),
      initialScale,
    );
    const { backgroundColor: initialBackground, borderRadius: initialRadius } =
      latestStyleRef.current;

    const key = persistKeyRef.current;
    const pendingRelease = key ? pendingReleases.get(key) : undefined;
    const pendingCreate = key ? pendingCreates.get(key) : undefined;

    const performCreate = async () => {
      if (pendingCreate) {
        debugLog("awaiting-pending-create", { persistKey: key });
        try {
          await pendingCreate;
        } catch {
          // ignore failures from previous create attempts
        }
      }

      if (pendingRelease) {
        debugLog("awaiting-pending-release", { persistKey: key });
        try {
          await pendingRelease;
        } catch {
          // ignore pending release failures; we'll attempt to create regardless
        }
      }

      const createTask = (async () => {
        try {
          debugLog("creating-native-view", {
            persistKey: key,
            url: latestSrcRef.current,
            bounds: initialBounds,
          });
          const result = await bridge.create({
            url: latestSrcRef.current,
            requestUrl: latestRequestUrlRef.current,
            bounds: initialBounds,
            backgroundColor: initialBackground,
            borderRadius: initialRadius,
            persistKey: key,
          });

          if (disposed) {
            debugLog("create-result-after-dispose", {
              id: result.id,
              persistKey: key,
            });
            releaseNativeView(result.id, persistKeyRef.current);
            return;
          }
          debugLog("create-result", {
            id: result.id,
            persistKey: key,
            restored: result.restored,
          });
          viewIdRef.current = result.id;
          registerActions(result.webContentsId);
          hasStableAttachmentRef.current = true;
          onNativeViewReady?.(result);
          const targetUrl = latestSrcRef.current;
          if (!result.restored) {
            void bridge
              .loadURL(result.id, targetUrl)
              .then(() => {
                debugLog("load-url-complete", {
                  id: result.id,
                  persistKey: key,
                  url: targetUrl,
                });
                lastLoadedSrcRef.current = targetUrl;
              })
              .catch((err) =>
                console.warn("Failed to load URL after create", err),
              );
          } else {
            debugLog("restored-native-view", {
              id: result.id,
              persistKey: key,
              url: targetUrl,
            });
            lastLoadedSrcRef.current = targetUrl;
          }
          scheduleBoundsSync();
        } catch (err) {
          console.error("Failed to create WebContentsView", err);
          setErrorMessage("Unable to create Electron WebContentsView");
          onNativeViewDestroyed?.();
        }
      })();

      if (key) {
        const trackedCreate = createTask.finally(() => {
          if (pendingCreates.get(key) === trackedCreate) {
            pendingCreates.delete(key);
          }
        });
        pendingCreates.set(key, trackedCreate);
      }

      await createTask;
    };

    void performCreate();

    return () => {
      disposed = true;
      releaseView();
    };
  }, [
    persistKey,
    releaseNativeView,
    releaseView,
    scheduleBoundsSync,
    registerActions,
    onNativeViewDestroyed,
    onNativeViewReady,
  ]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = getWebContentsBridge();
    const id = viewIdRef.current;
    if (!bridge || id === null) return;
    if (lastLoadedSrcRef.current === src) return;
    debugLog("load-url-request", {
      id,
      url: src,
      persistKey: persistKeyRef.current,
    });
    void bridge
      .loadURL(id, src)
      .then(() => {
        debugLog("load-url-after-update", {
          id,
          persistKey: persistKeyRef.current,
          url: src,
        });
        lastLoadedSrcRef.current = src;
      })
      .catch((err) =>
        console.warn("Failed to load URL in WebContentsView", err),
      );
  }, [src]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = getWebContentsBridge();
    const id = viewIdRef.current;
    if (!bridge || id === null) return;
    if (backgroundColor === undefined && borderRadius === undefined) return;
    void bridge
      .updateStyle({ id, backgroundColor, borderRadius })
      .catch((err) =>
        console.warn("Failed to update WebContentsView style", err),
      );
  }, [backgroundColor, borderRadius]);

  useEffect(() => {
    if (!isElectron) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    scheduleBoundsSync();

    const cleanupFns: Array<() => void> = [];

    const handleDimensionChange = () => {
      scheduleBoundsSync();
    };

    if (typeof ResizeObserver !== "undefined") {
      const ownResizeObserver = new ResizeObserver(handleDimensionChange);
      ownResizeObserver.observe(container);
      cleanupFns.push(() => ownResizeObserver.disconnect());

      const ancestorObservers: ResizeObserver[] = [];
      let node: HTMLElement | null = container.parentElement;
      while (node) {
        const observer = new ResizeObserver(handleDimensionChange);
        observer.observe(node);
        ancestorObservers.push(observer);
        node = node.parentElement;
      }
      if (ancestorObservers.length > 0) {
        cleanupFns.push(() => {
          for (const observer of ancestorObservers) {
            observer.disconnect();
          }
        });
      }
    }

    const handleScroll = () => {
      scheduleBoundsSync();
    };

    const refreshScrollTargets = () => {
      scrollCleanupsRef.current.forEach((cleanup) => cleanup());
      scrollCleanupsRef.current = [];
      const scrollTargets = getScrollableAncestors(container);
      for (const target of scrollTargets) {
        const eventTarget: EventTarget =
          target === window ? window : (target as EventTarget);
        eventTarget.addEventListener("scroll", handleScroll, { passive: true });
        const cleanup = () => {
          eventTarget.removeEventListener("scroll", handleScroll);
        };
        cleanupFns.push(cleanup);
        scrollCleanupsRef.current.push(cleanup);
      }
    };

    refreshScrollTargets();

    const handleViewport = () => {
      scheduleBoundsSync();
    };

    window.addEventListener("resize", handleViewport);
    cleanupFns.push(() => window.removeEventListener("resize", handleViewport));

    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener("resize", handleViewport);
      viewport.addEventListener("scroll", handleViewport, { passive: true });
      cleanupFns.push(() =>
        viewport.removeEventListener("resize", handleViewport),
      );
      cleanupFns.push(() =>
        viewport.removeEventListener("scroll", handleViewport),
      );
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target === container) {
              const intersects =
                entry.isIntersecting || entry.intersectionRatio > 0;
              if (isIntersectingRef.current !== intersects) {
                isIntersectingRef.current = intersects;
                scheduleBoundsSync();
              }
            }
          }
        },
        { threshold: [0, 0.01, 1] },
      );
      intersectionObserver.observe(container);
      cleanupFns.push(() => intersectionObserver?.disconnect());
    } else {
      isIntersectingRef.current = true;
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        startContinuousSync();
        refreshScrollTargets();
        scheduleBoundsSync();
      });
      let node: HTMLElement | null = container;
      while (node) {
        mutationObserver.observe(node, {
          attributes: true,
          attributeFilter: ["style", "class"],
        });
        node = node.parentElement;
      }
      cleanupFns.push(() => mutationObserver?.disconnect());
    }

    const handleAnimationStart: EventListener = () => {
      startContinuousSync();
      scheduleBoundsSync();
    };
    const handleAnimationStop: EventListener = () => {
      scheduleBoundsSync();
    };

    const animationEvents: Array<[keyof HTMLElementEventMap, EventListener]> = [
      ["animationstart", handleAnimationStart],
      ["animationiteration", handleAnimationStart],
      ["transitionrun", handleAnimationStart],
      ["transitionstart", handleAnimationStart],
      ["animationend", handleAnimationStop],
      ["animationcancel", handleAnimationStop],
      ["transitionend", handleAnimationStop],
      ["transitioncancel", handleAnimationStop],
    ];

    for (const [event, listener] of animationEvents) {
      container.addEventListener(event, listener);
      cleanupFns.push(() => container.removeEventListener(event, listener));
    }

    return () => {
      cleanupFns.forEach((cleanup) => cleanup());
      scrollCleanupsRef.current = [];
    };
  }, [scheduleBoundsSync, startContinuousSync]);

  useLayoutEffect(() => {
    if (!isElectron) return;
    scheduleBoundsSync();
  }, [scheduleBoundsSync]);

  useEffect(() => {
    if (!isElectron) return;
    scheduleBoundsSync();
  }, [scheduleBoundsSync, suspended]);

  const shouldShowFallback = !isElectron || errorMessage !== null;

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full", className)}
      style={{ ...style, borderRadius }}
      data-role="electron-web-contents-view"
      data-suspended={suspended ? "true" : "false"}
      data-drag-disable-pointer
    >
      {shouldShowFallback ? (
        <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white/80 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-300">
          {errorMessage ??
            fallback ??
            "Open this view in the Electron app to see the embedded page."}
        </div>
      ) : null}
    </div>
  );
}
