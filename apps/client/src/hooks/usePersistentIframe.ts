import { useCallback, useEffect, useRef } from "react";
import { persistentIframeManager } from "../lib/persistentIframeManager";

interface UsePersistentIframeOptions {
  /**
   * Unique key to identify this iframe instance
   */
  key: string;

  /**
   * URL to load in the iframe
   */
  url: string;

  /**
   * Whether to preload the iframe before mounting (default: false)
   */
  preload?: boolean;

  /**
   * Callback when iframe is loaded
   */
  onLoad?: () => void;

  /**
   * Callback when iframe fails to load
   */
  onError?: (error: Error) => void;

  /**
   * CSS class names to apply to the iframe
   */
  className?: string;

  /**
   * Inline styles to apply to the iframe
   */
  style?: React.CSSProperties;

  /**
   * Permissions for the iframe (e.g., "clipboard-read", "clipboard-write")
   */
  allow?: string;

  /**
   * Sandbox attribute for the iframe
   */
  sandbox?: string;
}

export function usePersistentIframe({
  key,
  url,
  preload = false,
  onLoad,
  onError,
  className,
  style,
  allow,
  sandbox,
}: UsePersistentIframeOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Store current callbacks in refs to avoid stale closure issues and allow
  // proper cleanup of event listeners when the effect re-runs
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);

  // Keep refs up to date
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  }, [onLoad, onError]);

  // Preload effect
  useEffect(() => {
    if (preload) {
      persistentIframeManager
        .preloadIframe(key, url, { allow, sandbox })
        .then(() => onLoadRef.current?.())
        .catch((error) => onErrorRef.current?.(error));
    }
  }, [key, url, preload, allow, sandbox]);

  // Mount/unmount effect - intentionally excludes onLoad/onError from deps
  // to prevent effect re-runs when callbacks change. The refs ensure we
  // always call the latest callbacks.
  useEffect(() => {
    if (!containerRef.current) return;

    let loadHandler: (() => void) | null = null;
    let errorHandler: (() => void) | null = null;
    let iframe: HTMLIFrameElement | null = null;

    try {
      // Get or create the iframe
      iframe = persistentIframeManager.getOrCreateIframe(key, url, { allow, sandbox });

      // Set up load handlers if not already loaded
      if (!iframe.contentWindow || iframe.src !== url) {
        loadHandler = () => {
          if (iframe) {
            iframe.removeEventListener("load", loadHandler!);
            iframe.removeEventListener("error", errorHandler!);
          }
          onLoadRef.current?.();
        };

        errorHandler = () => {
          if (iframe) {
            iframe.removeEventListener("load", loadHandler!);
            iframe.removeEventListener("error", errorHandler!);
          }
          onErrorRef.current?.(new Error(`Failed to load iframe: ${url}`));
        };

        iframe.addEventListener("load", loadHandler);
        iframe.addEventListener("error", errorHandler);
      } else if (!preload) {
        // Already loaded and not from preload
        onLoadRef.current?.();
      }

      // Mount the iframe (returns cleanup function)
      cleanupRef.current = persistentIframeManager.mountIframe(
        key,
        containerRef.current,
        {
          className,
          style,
          allow,
          sandbox,
        }
      );
    } catch (error) {
      console.error("Error mounting iframe:", error);
      onErrorRef.current?.(error as Error);
    }

    // Cleanup - remove event listeners to prevent stale callbacks and memory leaks
    return () => {
      if (iframe && loadHandler && errorHandler) {
        iframe.removeEventListener("load", loadHandler);
        iframe.removeEventListener("error", errorHandler);
      }
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [key, url, className, style, allow, sandbox, preload]);

  const handlePreload = useCallback(() => {
    return persistentIframeManager.preloadIframe(key, url, { allow, sandbox });
  }, [key, url, allow, sandbox]);

  const handleRemove = useCallback(() => {
    persistentIframeManager.removeIframe(key);
  }, [key]);

  const handleIsLoaded = useCallback(() => {
    try {
      const iframe = persistentIframeManager.getOrCreateIframe(key, url, { allow, sandbox });
      return iframe.contentWindow !== null && iframe.src === url;
    } catch {
      return false;
    }
  }, [key, url, allow, sandbox]);

  return {
    containerRef,
    preload: handlePreload,
    remove: handleRemove,
    isLoaded: handleIsLoaded,
  };
}
