import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { disableDragPointerEvents, restoreDragPointerEvents } from "@/lib/drag-pointer-events";

interface ResizableGridProps {
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  bottomRight: React.ReactNode;
  storageKey?: string;
  defaultLeftWidth?: number; // percentage (0-100)
  defaultTopHeight?: number; // percentage (0-100)
  minWidth?: number; // percentage
  maxWidth?: number; // percentage
  minHeight?: number; // percentage
  maxHeight?: number; // percentage
  className?: string;
}

export function ResizableGrid({
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  storageKey = "resizableGrid",
  defaultLeftWidth = 50,
  defaultTopHeight = 50,
  minWidth = 20,
  maxWidth = 80,
  minHeight = 20,
  maxHeight = 80,
  className,
}: ResizableGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const stored = storageKey ? localStorage.getItem(`${storageKey}-leftWidth`) : null;
    const parsed = stored ? Number.parseFloat(stored) : defaultLeftWidth;
    if (Number.isNaN(parsed)) return defaultLeftWidth;
    return Math.min(Math.max(parsed, minWidth), maxWidth);
  });

  const [topHeight, setTopHeight] = useState<number>(() => {
    const stored = storageKey ? localStorage.getItem(`${storageKey}-topHeight`) : null;
    const parsed = stored ? Number.parseFloat(stored) : defaultTopHeight;
    if (Number.isNaN(parsed)) return defaultTopHeight;
    return Math.min(Math.max(parsed, minHeight), maxHeight);
  });

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`${storageKey}-leftWidth`, String(leftWidth));
      localStorage.setItem(`${storageKey}-topHeight`, String(topHeight));
    }
  }, [leftWidth, topHeight, storageKey]);

  const onMouseMoveHorizontal = useCallback(
    (e: MouseEvent) => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
        setLeftWidth(Math.min(Math.max(newWidth, minWidth), maxWidth));
      });
    },
    [minWidth, maxWidth]
  );

  const onMouseMoveVertical = useCallback(
    (e: MouseEvent) => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const newHeight = ((e.clientY - rect.top) / rect.height) * 100;
        setTopHeight(Math.min(Math.max(newHeight, minHeight), maxHeight));
      });
    },
    [minHeight, maxHeight]
  );

  const stopResizing = useCallback(() => {
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    restoreDragPointerEvents();
    window.removeEventListener("mousemove", onMouseMoveHorizontal);
    window.removeEventListener("mousemove", onMouseMoveVertical);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMoveHorizontal, onMouseMoveVertical]);

  const startResizingHorizontal = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      document.body.style.cursor = "col-resize";
      document.body.classList.add("select-none");
      disableDragPointerEvents();
      window.addEventListener("mousemove", onMouseMoveHorizontal);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMoveHorizontal, stopResizing]
  );

  const startResizingVertical = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      document.body.style.cursor = "row-resize";
      document.body.classList.add("select-none");
      disableDragPointerEvents();
      window.addEventListener("mousemove", onMouseMoveVertical);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMoveVertical, stopResizing]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMoveHorizontal);
      window.removeEventListener("mousemove", onMouseMoveVertical);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [onMouseMoveHorizontal, onMouseMoveVertical, stopResizing]);

  const rightWidth = 100 - leftWidth;
  const bottomHeight = 100 - topHeight;

  return (
    <div ref={containerRef} className={clsx("relative h-full w-full", className)}>
      {/* Grid layout */}
      <div className="h-full w-full grid" style={{
        gridTemplateColumns: `${leftWidth}% ${rightWidth}%`,
        gridTemplateRows: `${topHeight}% ${bottomHeight}%`,
        gap: "4px",
      }}>
        {/* Top Left */}
        <div className="min-h-0 min-w-0">{topLeft}</div>

        {/* Top Right */}
        <div className="min-h-0 min-w-0">{topRight}</div>

        {/* Bottom Left */}
        <div className="min-h-0 min-w-0">{bottomLeft}</div>

        {/* Bottom Right */}
        <div className="min-h-0 min-w-0">{bottomRight}</div>
      </div>

      {/* Horizontal resize handle (vertical separator between columns) */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startResizingHorizontal}
        className={clsx(
          "group absolute top-0 bottom-0 cursor-col-resize bg-transparent transition-colors z-10",
        )}
        style={{
          width: "8px",
          left: `calc(${leftWidth}% - 4px)`,
        }}
        title="Resize columns"
      >
        <div className="absolute top-0 bottom-0 w-px bg-transparent group-hover:bg-neutral-400 dark:group-hover:bg-neutral-600 group-active:bg-neutral-500 dark:group-active:bg-neutral-500 transition-colors" style={{ left: "calc(50% + 2px)" }} />
      </div>

      {/* Vertical resize handle (horizontal separator between rows) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={startResizingVertical}
        className={clsx(
          "group absolute left-0 right-0 cursor-row-resize bg-transparent transition-colors z-10",
        )}
        style={{
          height: "8px",
          top: `calc(${topHeight}% - 4px)`,
        }}
        title="Resize rows"
      >
        <div className="absolute left-0 right-0 h-px bg-transparent group-hover:bg-neutral-400 dark:group-hover:bg-neutral-600 group-active:bg-neutral-500 dark:group-active:bg-neutral-500 transition-colors" style={{ top: "calc(50% + 2px)" }} />
      </div>
    </div>
  );
}

export default ResizableGrid;
