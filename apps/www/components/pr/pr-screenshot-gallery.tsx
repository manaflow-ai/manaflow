"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { Id } from "@cmux/convex/dataModel";

import { cn } from "@/lib/utils";

type ScreenshotStatus = "completed" | "failed" | "skipped";

export type PrScreenshotImage = {
  storageId: Id<"_storage">;
  mimeType: string;
  fileName?: string | null;
  commitSha?: string | null;
  description?: string | null;
  url?: string | null;
};

export type PrScreenshotSet = {
  _id: Id<"taskRunScreenshotSets">;
  taskId: Id<"tasks">;
  runId: Id<"taskRuns">;
  status: ScreenshotStatus;
  commitSha?: string | null;
  capturedAt: number;
  error?: string | null;
  hasUiChanges?: boolean;
  images: PrScreenshotImage[];
};

type PrScreenshotGalleryProps = {
  screenshotSets: PrScreenshotSet[];
  highlightedSetId?: Id<"taskRunScreenshotSets"> | null;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 40;

const STATUS_LABELS: Record<ScreenshotStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLES: Record<ScreenshotStatus, string> = {
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  skipped: "bg-neutral-200 text-neutral-700",
};

const getImageKey = (
  setId: Id<"taskRunScreenshotSets">,
  image: PrScreenshotImage,
  indexInSet: number
) => `${setId}:${image.storageId}:${indexInSet}`;

export function PrScreenshotGallery({
  screenshotSets,
  highlightedSetId,
}: PrScreenshotGalleryProps) {
  const sortedScreenshotSets = useMemo(
    () =>
      [...screenshotSets].sort((a, b) => {
        if (a.capturedAt !== b.capturedAt) {
          return b.capturedAt - a.capturedAt;
        }
        return b._id.localeCompare(a._id);
      }),
    [screenshotSets]
  );

  const flattenedImages = useMemo(() => {
    const entries: Array<{
      set: PrScreenshotSet;
      image: PrScreenshotImage;
      indexInSet: number;
      key: string;
      globalIndex: number;
    }> = [];

    sortedScreenshotSets.forEach((set) => {
      set.images.forEach((image, indexInSet) => {
        if (!image.url) return;

        entries.push({
          set,
          image,
          indexInSet,
          key: getImageKey(set._id, image, indexInSet),
          globalIndex: entries.length,
        });
      });
    });

    return entries;
  }, [sortedScreenshotSets]);

  const globalIndexByKey = useMemo(() => {
    const indexMap = new Map<string, number>();
    flattenedImages.forEach((entry) => {
      indexMap.set(entry.key, entry.globalIndex);
    });
    return indexMap;
  }, [flattenedImages]);

  const [activeImageKey, setActiveImageKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [baseImageScale, setBaseImageScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const defaultZoomRef = useRef(1);
  const defaultOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const clampZoom = useCallback((value: number) => {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }, []);

  const setZoomWithFocus = useCallback(
    (
      resolver: (prevZoom: number) => number,
      focusPoint: { x: number; y: number } = { x: 0, y: 0 }
    ) => {
      setZoom((prevZoom) => {
        const safePrevZoom = prevZoom || 1;
        const nextZoom = clampZoom(resolver(safePrevZoom));
        if (nextZoom === safePrevZoom) {
          return nextZoom;
        }
        setOffset((prevOffset) => ({
          x:
            focusPoint.x -
            (nextZoom * (focusPoint.x - prevOffset.x)) / safePrevZoom,
          y:
            focusPoint.y -
            (nextZoom * (focusPoint.y - prevOffset.y)) / safePrevZoom,
        }));
        return nextZoom;
      });
    },
    [clampZoom]
  );

  const resetZoomState = useCallback(
    (options?: { zoom?: number; offset?: { x: number; y: number } }) => {
      const targetZoom = clampZoom(options?.zoom ?? defaultZoomRef.current);
      setZoom(targetZoom);
      setOffset(options?.offset ?? defaultOffsetRef.current);
      setIsPanning(false);
      panPointerIdRef.current = null;
      lastPanPositionRef.current = null;
    },
    [clampZoom]
  );

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    if (!viewportRect || naturalWidth <= 0 || naturalHeight <= 0) {
      setBaseImageScale(1);
      defaultZoomRef.current = 1;
      defaultOffsetRef.current = { x: 0, y: 0 };
      resetZoomState({ zoom: 1, offset: { x: 0, y: 0 } });
      return;
    }

    const viewportWidth = viewportRect.width;
    const viewportHeight = viewportRect.height;
    const baseScale = Math.min(
      viewportWidth / naturalWidth,
      viewportHeight / naturalHeight
    );
    const normalizedBaseScale = Math.min(1, baseScale);
    setBaseImageScale(normalizedBaseScale);
    const baseWidth = naturalWidth * baseScale;
    const baseHeight = naturalHeight * baseScale;

    const fitHeightZoom = viewportHeight / baseHeight;
    const fitWidthZoom = viewportWidth / baseWidth;
    const desiredZoom = Math.min(1, fitHeightZoom, fitWidthZoom);
    const clampedZoom = clampZoom(desiredZoom);

    const scaledHeight = baseHeight * clampedZoom;
    const offsetY = -((viewportHeight - scaledHeight) / 2);
    const initialOffset = { x: 0, y: offsetY };

    defaultZoomRef.current = clampedZoom;
    defaultOffsetRef.current = initialOffset;
    resetZoomState({ zoom: clampedZoom, offset: initialOffset });
  };

  const activeImageIndex =
    activeImageKey !== null ? globalIndexByKey.get(activeImageKey) ?? null : null;
  const currentEntry =
    activeImageIndex !== null &&
    activeImageIndex >= 0 &&
    activeImageIndex < flattenedImages.length
      ? flattenedImages[activeImageIndex]
      : null;

  const activeOverallIndex =
    currentEntry?.globalIndex !== undefined
      ? currentEntry.globalIndex + 1
      : null;

  const effectiveHighlight =
    highlightedSetId ?? sortedScreenshotSets[0]?._id ?? null;

  useEffect(() => {
    if (activeImageKey === null) {
      return;
    }
    if (flattenedImages.length === 0 || !globalIndexByKey.has(activeImageKey)) {
      setActiveImageKey(null);
    }
  }, [activeImageKey, flattenedImages.length, globalIndexByKey]);

  useEffect(() => {
    defaultZoomRef.current = 1;
    defaultOffsetRef.current = { x: 0, y: 0 };
    setBaseImageScale(1);
    resetZoomState({ zoom: 1, offset: { x: 0, y: 0 } });
  }, [currentEntry?.key, resetZoomState]);

  const closeSlideshow = useCallback(() => {
    setActiveImageKey(null);
  }, []);

  const goNext = useCallback(() => {
    if (activeImageIndex === null) return;
    const len = flattenedImages.length;
    if (len <= 1) return;
    const nextIndex = (activeImageIndex + 1) % len;
    setActiveImageKey(flattenedImages[nextIndex]?.key ?? null);
  }, [activeImageIndex, flattenedImages]);

  const goPrev = useCallback(() => {
    if (activeImageIndex === null) return;
    const len = flattenedImages.length;
    if (len <= 1) return;
    const nextIndex = (activeImageIndex - 1 + len) % len;
    setActiveImageKey(flattenedImages[nextIndex]?.key ?? null);
  }, [activeImageIndex, flattenedImages]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const delta = -event.deltaY;
      const scale = Math.exp(delta * 0.001);
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      const focus = viewportRect
        ? { x: event.clientX - viewportRect.left, y: event.clientY - viewportRect.top }
        : { x: 0, y: 0 };
      setZoomWithFocus((prevZoom) => prevZoom * scale, focus);
    },
    [setZoomWithFocus]
  );

  const startPanning = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      panPointerIdRef.current = event.pointerId;
      lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
      setIsPanning(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    []
  );

  const stopPanning = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panPointerIdRef.current !== event.pointerId) return;
    setIsPanning(false);
    panPointerIdRef.current = null;
    lastPanPositionRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanning || panPointerIdRef.current !== event.pointerId) return;
    const lastPos = lastPanPositionRef.current;
    if (!lastPos) return;
    const deltaX = event.clientX - lastPos.x;
    const deltaY = event.clientY - lastPos.y;
    lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
    setOffset((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
  }, [isPanning]);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (panPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      stopPanning(event);
    },
    [stopPanning]
  );

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isPanning) return;
      stopPanning(event);
    },
    [isPanning, stopPanning]
  );

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (panPointerIdRef.current !== event.pointerId) return;
      stopPanning(event);
    },
    [stopPanning]
  );

  const handleZoomIn = useCallback(() => {
    setZoomWithFocus((prevZoom) => prevZoom * 1.2);
  }, [setZoomWithFocus]);

  const handleZoomOut = useCallback(() => {
    setZoomWithFocus((prevZoom) => prevZoom / 1.2);
  }, [setZoomWithFocus]);

  const isSlideshowOpen = activeImageKey !== null;

  useEffect(() => {
    if (!isSlideshowOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSlideshow();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [closeSlideshow, goNext, goPrev, isSlideshowOpen]);

  if (sortedScreenshotSets.length === 0) {
    return null;
  }

  const zoomPercent = Math.round(zoom * 100 * baseImageScale);
  const canZoomOut = zoom / 1.2 >= MIN_ZOOM;
  const canZoomIn = zoom * 1.2 <= MAX_ZOOM;
  const canResetZoom = Math.abs(zoom - defaultZoomRef.current) > 0.01;
  const hasMultipleImages = flattenedImages.length > 1;
  const showNavButtons = hasMultipleImages && !!currentEntry;

  const overlay =
    isSlideshowOpen && currentEntry && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 px-4 py-6"
            onClick={closeSlideshow}
          >
            <div
              className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-[1200px] flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-base font-semibold text-neutral-900">
                    {activeOverallIndex !== null ? `${activeOverallIndex}. ` : ""}
                    {currentEntry.image.fileName ?? "Screenshot"}
                  </p>
                  <p className="text-xs text-neutral-600">
                    Image {currentEntry.indexInSet + 1} of {currentEntry.set.images.length}
                    <span className="px-1 text-neutral-400">•</span>
                    {formatDistanceToNow(new Date(currentEntry.set.capturedAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-600 shadow-sm">
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      disabled={!canZoomOut}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                      aria-label="Zoom out"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[3rem] text-center tabular-nums">
                      {zoomPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      disabled={!canZoomIn}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                      aria-label="Zoom in"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => resetZoomState()}
                      disabled={!canResetZoom}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                      aria-label="Reset zoom"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={closeSlideshow}
                    className="rounded-full p-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                    aria-label="Close slideshow"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-1 items-center gap-4">
                {showNavButtons ? (
                  <button
                    type="button"
                    onClick={goPrev}
                    className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                ) : null}
                <div
                  ref={viewportRef}
                  className={cn(
                    "relative flex h-[70vh] max-h-[calc(100vh-10rem)] min-h-[360px] w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50",
                    zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
                  )}
                  onWheel={handleWheel}
                  onPointerDown={startPanning}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                  onPointerCancel={handlePointerCancel}
                  onDoubleClick={() => resetZoomState()}
                  style={{ touchAction: "none" }}
                >
                  <img
                    src={currentEntry.image.url ?? undefined}
                    alt={currentEntry.image.fileName ?? "Screenshot"}
                    className="select-none h-full w-full object-contain"
                    draggable={false}
                    onLoad={handleImageLoad}
                    style={{
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                      transition: isPanning ? "none" : "transform 120ms ease-out",
                    }}
                  />
                </div>
                {showNavButtons ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
              {hasMultipleImages ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
                    <span className="sr-only">All screenshots</span>
                    <span className="tabular-nums text-neutral-600">
                      {activeOverallIndex ?? "–"} / {flattenedImages.length}
                    </span>
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {flattenedImages.map((entry) => {
                      const isActiveThumb = entry.key === currentEntry?.key;
                      const label = entry.globalIndex + 1;
                      const displayName = entry.image.fileName ?? "Screenshot";

                      return (
                        <button
                          key={entry.key}
                          type="button"
                          onClick={() => setActiveImageKey(entry.key)}
                          className={cn(
                            "group relative flex h-24 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-1 transition hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70",
                            isActiveThumb && "border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.3)]"
                          )}
                          aria-label={`View ${displayName}`}
                          aria-current={isActiveThumb ? "true" : undefined}
                          title={displayName}
                        >
                          <img
                            src={entry.image.url ?? undefined}
                            alt={displayName}
                            className="h-full w-full object-contain"
                            loading="lazy"
                            decoding="async"
                          />
                          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-neutral-950/80 px-1 text-[10px] font-semibold text-white shadow-sm">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-white shadow-sm">
      {overlay}
      <div className="flex items-center justify-between gap-3 border-b border-amber-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">UI screenshots</p>
          <p className="text-xs text-neutral-600">Captured alongside this pull request</p>
        </div>
        <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-1 text-xs font-medium text-neutral-600">
          {sortedScreenshotSets.length} {sortedScreenshotSets.length === 1 ? "capture" : "captures"}
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        {sortedScreenshotSets.map((set) => {
          const capturedAtDate = new Date(set.capturedAt);
          const relativeCapturedAt = formatDistanceToNow(capturedAtDate, {
            addSuffix: true,
          });
          const shortCommit = set.commitSha?.slice(0, 12);
          const isHighlighted = effectiveHighlight === set._id;
          const renderableImages = set.images.filter((image) => Boolean(image.url));

          return (
            <article
              key={set._id}
              className={cn(
                "rounded-lg border border-neutral-200 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]",
                isHighlighted && "border-amber-300 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("px-2 py-0.5 text-xs font-medium rounded-full", STATUS_STYLES[set.status])}>
                  {STATUS_LABELS[set.status]}
                </span>
                {isHighlighted && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Latest
                  </span>
                )}
                <span className="text-xs text-neutral-600" title={capturedAtDate.toLocaleString()}>
                  {relativeCapturedAt}
                </span>
                {shortCommit && (
                  <span className="text-xs font-mono text-neutral-600">
                    {shortCommit.toLowerCase()}
                  </span>
                )}
                {set.hasUiChanges ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    UI changes detected
                  </span>
                ) : null}
              </div>
              {set.error && (
                <p className="mt-2 text-xs text-rose-600">{set.error}</p>
              )}
              {renderableImages.length > 0 ? (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                  {renderableImages.map((image, indexInSet) => {
                    const displayName = image.fileName ?? "Screenshot";
                    const stableKey = getImageKey(set._id, image, indexInSet);
                    const flatIndex = globalIndexByKey.get(stableKey) ?? null;
                    const humanIndex = flatIndex !== null ? flatIndex + 1 : null;
                    const isActive = activeImageKey === stableKey;

                    return (
                      <button
                        key={stableKey}
                        type="button"
                        onClick={() => setActiveImageKey(stableKey)}
                        className={cn(
                          "group relative flex w-[220px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left transition-colors hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70",
                          isActive && "border-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.3)]"
                        )}
                        aria-label={`Open ${displayName} in slideshow`}
                      >
                        <img
                          src={image.url ?? undefined}
                          alt={displayName}
                          className="h-48 w-[220px] object-contain bg-neutral-100"
                          loading="lazy"
                        />
                        <div className="absolute top-2 right-2 text-neutral-600 opacity-0 transition group-hover:opacity-100">
                          <Maximize2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="border-t border-neutral-200 px-2 py-1 text-xs text-neutral-600 truncate">
                          {humanIndex !== null ? `${humanIndex}. ` : ""}
                          {displayName}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500">
                  {set.status === "failed"
                    ? "Screenshot capture failed before any images were saved."
                    : "No screenshots were captured for this attempt."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
