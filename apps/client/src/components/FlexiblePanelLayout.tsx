import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LayoutMode } from "@/lib/panel-config";
import { disableDragPointerEvents, restoreDragPointerEvents } from "@/lib/drag-pointer-events";

const PANEL_GAP = 4;
const PANEL_GAP_HALF = PANEL_GAP / 2;
const HANDLE_SIZE = 8;

interface FlexiblePanelLayoutProps {
  layoutMode: LayoutMode;
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  bottomRight: React.ReactNode;
  storageKey?: string;
  className?: string;
}

export function FlexiblePanelLayout({
  layoutMode,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  storageKey = "flexiblePanelLayout",
  className,
}: FlexiblePanelLayoutProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Load saved split positions for different layout modes
  const [horizontalSplit, setHorizontalSplit] = useState<number>(() => {
    const stored = storageKey ? localStorage.getItem(`${storageKey}-horizontal`) : null;
    const parsed = stored ? Number.parseFloat(stored) : 50;
    return Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 20), 80);
  });

  const [verticalSplit, setVerticalSplit] = useState<number>(() => {
    const stored = storageKey ? localStorage.getItem(`${storageKey}-vertical`) : null;
    const parsed = stored ? Number.parseFloat(stored) : 50;
    return Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 20), 80);
  });

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`${storageKey}-horizontal`, String(horizontalSplit));
      localStorage.setItem(`${storageKey}-vertical`, String(verticalSplit));
    }
  }, [horizontalSplit, verticalSplit, storageKey]);

  const onMouseMoveHorizontal = useCallback(
    (e: MouseEvent) => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const newSplit = ((e.clientX - rect.left) / rect.width) * 100;
        setHorizontalSplit(Math.min(Math.max(newSplit, 20), 80));
      });
    },
    []
  );

  const onMouseMoveVertical = useCallback(
    (e: MouseEvent) => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const newSplit = ((e.clientY - rect.top) / rect.height) * 100;
        setVerticalSplit(Math.min(Math.max(newSplit, 20), 80));
      });
    },
    []
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

  const renderResizeHandle = (
    orientation: "horizontal" | "vertical",
    position: string,
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  ) => (
    <div
      role="separator"
      aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      onMouseDown={onMouseDown}
      className={clsx(
        "group absolute bg-transparent transition-colors z-10",
        orientation === "horizontal"
          ? "top-0 bottom-0 cursor-col-resize"
          : "left-0 right-0 cursor-row-resize"
      )}
      style={
        orientation === "horizontal"
          ? {
              top: 0,
              bottom: 0,
              left: position,
              width: `${HANDLE_SIZE}px`,
              transform: "translate(-50%, -2px)",
            }
          : {
              left: 0,
              right: 0,
              top: position,
              height: `${HANDLE_SIZE}px`,
              transform: "translate(-2px, -50%)",
            }
      }
      title={`Resize ${orientation === "horizontal" ? "columns" : "rows"}`}
    >
      <div
        className="absolute bg-transparent group-hover:bg-neutral-400 dark:group-hover:bg-neutral-600 group-active:bg-neutral-500 dark:group-active:bg-neutral-500 transition-colors"
        style={
          orientation === "horizontal"
            ? { top: 0, bottom: 0, width: "1px", left: "50%", transform: "translateX(-50%)" }
            : { left: 0, right: 0, height: "1px", top: "50%", transform: "translateY(-50%)" }
        }
      />
    </div>
  );

  const renderLayout = () => {
    const gapPx = `${PANEL_GAP}px`;
    const createSplitTrackSizes = (split: number) =>
      `calc(${split}% - ${PANEL_GAP_HALF}px) calc(${100 - split}% - ${PANEL_GAP_HALF}px)`;
    const horizontalTracks = createSplitTrackSizes(horizontalSplit);
    const verticalTracks = createSplitTrackSizes(verticalSplit);
    const horizontalHandlePosition = `${horizontalSplit}%`;
    const verticalHandlePosition = `${verticalSplit}%`;
    const rightColumnStart = `calc(${horizontalSplit}% + ${PANEL_GAP_HALF}px)`;
    const leftColumnEnd = `calc(${100 - horizontalSplit}% + ${PANEL_GAP_HALF}px)`;
    const topRowStart = `calc(${verticalSplit}% + ${PANEL_GAP_HALF}px)`;
    const bottomRowEnd = `calc(${100 - verticalSplit}% + ${PANEL_GAP_HALF}px)`;

    switch (layoutMode) {
      case "four-panel":
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateColumns: horizontalTracks,
                gridTemplateRows: verticalTracks,
                gap: gapPx,
              }}
            >
              <div className="min-h-0 min-w-0">{topLeft}</div>
              <div className="min-h-0 min-w-0">{topRight}</div>
              <div className="min-h-0 min-w-0">{bottomLeft}</div>
              <div className="min-h-0 min-w-0">{bottomRight}</div>
            </div>
            {renderResizeHandle("horizontal", horizontalHandlePosition, startResizingHorizontal)}
            {renderResizeHandle("vertical", verticalHandlePosition, startResizingVertical)}
          </>
        );

      case "two-horizontal":
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateColumns: horizontalTracks,
                gap: gapPx,
              }}
            >
              <div className="min-h-0 min-w-0">{topLeft}</div>
              <div className="min-h-0 min-w-0">{topRight}</div>
            </div>
            {renderResizeHandle("horizontal", horizontalHandlePosition, startResizingHorizontal)}
          </>
        );

      case "two-vertical":
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateRows: verticalTracks,
                gap: gapPx,
              }}
            >
              <div className="min-h-0 min-w-0">{topLeft}</div>
              <div className="min-h-0 min-w-0">{bottomLeft}</div>
            </div>
            {renderResizeHandle("vertical", verticalHandlePosition, startResizingVertical)}
          </>
        );

      case "three-left":
        // Large panel on left, two stacked on right
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateColumns: horizontalTracks,
                gridTemplateRows: "100%",
                gap: gapPx,
              }}
            >
              <div className="min-h-0 min-w-0">{topLeft}</div>
              <div
                className="min-h-0 min-w-0 grid"
                style={{
                  gridTemplateRows: verticalTracks,
                  gap: gapPx,
                }}
              >
                <div className="min-h-0 min-w-0">{topRight}</div>
                <div className="min-h-0 min-w-0">{bottomRight}</div>
              </div>
            </div>
            {renderResizeHandle("horizontal", horizontalHandlePosition, startResizingHorizontal)}
            <div
              style={{
                position: "absolute",
                left: rightColumnStart,
                right: 0,
                top: verticalHandlePosition,
                height: `${HANDLE_SIZE}px`,
              }}
            >
              {renderResizeHandle("vertical", "0px", startResizingVertical)}
            </div>
          </>
        );

      case "three-right":
        // Two stacked on left, large panel on right
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateColumns: horizontalTracks,
                gridTemplateRows: "100%",
                gap: gapPx,
              }}
            >
              <div
                className="min-h-0 min-w-0 grid"
                style={{
                  gridTemplateRows: verticalTracks,
                  gap: gapPx,
                }}
              >
                <div className="min-h-0 min-w-0">{topLeft}</div>
                <div className="min-h-0 min-w-0">{bottomLeft}</div>
              </div>
              <div className="min-h-0 min-w-0">{bottomRight}</div>
            </div>
            {renderResizeHandle("horizontal", horizontalHandlePosition, startResizingHorizontal)}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: leftColumnEnd,
                top: verticalHandlePosition,
                height: `${HANDLE_SIZE}px`,
              }}
            >
              {renderResizeHandle("vertical", "0px", startResizingVertical)}
            </div>
          </>
        );

      case "three-top":
        // Large panel on top, two side-by-side on bottom
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateRows: verticalTracks,
                gridTemplateColumns: "100%",
                gap: gapPx,
              }}
            >
              <div className="min-h-0 min-w-0">{topLeft}</div>
              <div
                className="min-h-0 min-w-0 grid"
                style={{
                  gridTemplateColumns: horizontalTracks,
                  gap: gapPx,
                }}
              >
                <div className="min-h-0 min-w-0">{bottomLeft}</div>
                <div className="min-h-0 min-w-0">{bottomRight}</div>
              </div>
            </div>
            {renderResizeHandle("vertical", verticalHandlePosition, startResizingVertical)}
            <div
              style={{
                position: "absolute",
                top: topRowStart,
                bottom: 0,
                left: horizontalHandlePosition,
                width: `${HANDLE_SIZE}px`,
              }}
            >
              {renderResizeHandle("horizontal", "0px", startResizingHorizontal)}
            </div>
          </>
        );

      case "three-bottom":
        // Two side-by-side on top, large panel on bottom
        return (
          <>
            <div
              className="h-full w-full grid"
              style={{
                gridTemplateRows: verticalTracks,
                gridTemplateColumns: "100%",
                gap: gapPx,
              }}
            >
              <div
                className="min-h-0 min-w-0 grid"
                style={{
                  gridTemplateColumns: horizontalTracks,
                  gap: gapPx,
                }}
              >
                <div className="min-h-0 min-w-0">{topLeft}</div>
                <div className="min-h-0 min-w-0">{topRight}</div>
              </div>
              <div className="min-h-0 min-w-0">{bottomRight}</div>
            </div>
            {renderResizeHandle("vertical", verticalHandlePosition, startResizingVertical)}
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: bottomRowEnd,
                left: horizontalHandlePosition,
                width: `${HANDLE_SIZE}px`,
              }}
            >
              {renderResizeHandle("horizontal", "0px", startResizingHorizontal)}
            </div>
          </>
        );
    }
  };

  return (
    <div ref={containerRef} className={clsx("relative h-full w-full", className)}>
      {renderLayout()}
    </div>
  );
}

export default FlexiblePanelLayout;
