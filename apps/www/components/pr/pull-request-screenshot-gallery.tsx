"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { api } from "@cmux/convex/api";

type ScreenshotSet = FunctionReturnType<
  typeof api.previewRuns.listScreenshotSetsForPr
>[number];
type ScreenshotStatus = ScreenshotSet["status"];

type FlattenedImage = {
  key: string;
  setId: ScreenshotSet["_id"];
  image: ScreenshotSet["images"][number];
  indexInSet: number;
  capturedAt: number;
  setCommitSha?: string | null;
};

type PullRequestScreenshotGalleryProps = {
  screenshotSets: ScreenshotSet[];
  isLoading: boolean;
  headCommitRef?: string | null;
};

const STATUS_LABELS: Record<ScreenshotStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLES: Record<ScreenshotStatus, string> = {
  completed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200",
  skipped:
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
};

function formatRelativeTime(timestamp: number): string {
  const diffInSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffInSeconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absSeconds < 60) return rtf.format(diffInSeconds, "second");
  if (absSeconds < 3_600)
    return rtf.format(Math.round(diffInSeconds / 60), "minute");
  if (absSeconds < 86_400)
    return rtf.format(Math.round(diffInSeconds / 3_600), "hour");
  if (absSeconds < 604_800)
    return rtf.format(Math.round(diffInSeconds / 86_400), "day");
  return rtf.format(Math.round(diffInSeconds / 604_800), "week");
}

export function PullRequestScreenshotGallery({
  screenshotSets,
  isLoading,
  headCommitRef,
}: PullRequestScreenshotGalleryProps) {
  const normalizedHead = headCommitRef?.toLowerCase().trim();
  const sortedSets = useMemo(
    () => [...screenshotSets].sort((a, b) => b.capturedAt - a.capturedAt),
    [screenshotSets]
  );

  const matchingSets = useMemo(() => {
    if (!normalizedHead) {
      return [];
    }
    return sortedSets.filter(
      (set) =>
        set.commitSha && set.commitSha.toLowerCase() === normalizedHead
    );
  }, [normalizedHead, sortedSets]);

  const displaySets = matchingSets.length > 0 ? matchingSets : sortedSets;
  const latestSetId = displaySets[0]?._id ?? null;

  const flattenedImages = useMemo<FlattenedImage[]>(() => {
    const entries: FlattenedImage[] = [];
    displaySets.forEach((set) => {
      set.images.forEach((image, indexInSet) => {
        if (!image.url) {
          return;
        }
        entries.push({
          key: `${set._id}:${image.storageId}:${indexInSet}`,
          setId: set._id,
          image,
          indexInSet,
          capturedAt: set.capturedAt,
          setCommitSha: set.commitSha,
        });
      });
    });
    return entries;
  }, [displaySets]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeIndex = useMemo(
    () => flattenedImages.findIndex((item) => item.key === activeKey),
    [activeKey, flattenedImages]
  );
  const activeEntry =
    activeIndex >= 0 ? flattenedImages[activeIndex] ?? null : null;

  const closeOverlay = useCallback(() => {
    setActiveKey(null);
  }, []);

  const goNext = useCallback(() => {
    if (flattenedImages.length === 0 || activeIndex < 0) {
      return;
    }
    const nextIndex = (activeIndex + 1) % flattenedImages.length;
    setActiveKey(flattenedImages[nextIndex]?.key ?? null);
  }, [activeIndex, flattenedImages]);

  const goPrev = useCallback(() => {
    if (flattenedImages.length === 0 || activeIndex < 0) {
      return;
    }
    const prevIndex =
      (activeIndex - 1 + flattenedImages.length) % flattenedImages.length;
    setActiveKey(flattenedImages[prevIndex]?.key ?? null);
  }, [activeIndex, flattenedImages]);

  useEffect(() => {
    if (!activeEntry) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlay();
      } else if (event.key === "ArrowRight") {
        goNext();
      } else if (event.key === "ArrowLeft") {
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [activeEntry, closeOverlay, goNext, goPrev]);

  if (isLoading) {
    return (
      <div className="rounded border border-neutral-200 bg-white p-5 pt-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/70 dark:text-neutral-300">
        Loading screenshots...
      </div>
    );
  }

  if (displaySets.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-neutral-200 bg-white p-5 pt-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/70 dark:text-neutral-200">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          Screenshots
        </h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {displaySets.length} capture{displaySets.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {displaySets.map((set) => {
          const capturedLabel = formatRelativeTime(set.capturedAt);
          const matchesHead =
            normalizedHead &&
            set.commitSha &&
            set.commitSha.toLowerCase() === normalizedHead;

          return (
            <article
              key={set._id}
              className={cn(
                "rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 shadow-sm transition-shadow dark:border-neutral-800 dark:bg-neutral-900/60",
                set._id === latestSetId &&
                  "border-sky-200 shadow-[0_0_0_1px_rgba(56,189,248,0.35)] dark:border-sky-800/70"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    STATUS_STYLES[set.status]
                  )}
                >
                  {STATUS_LABELS[set.status]}
                </span>
                {set._id === latestSetId ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                    Latest
                  </span>
                ) : null}
                {matchesHead ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                    Head commit
                  </span>
                ) : null}
                {set.hasUiChanges === false ? (
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                    No UI changes
                  </span>
                ) : null}
                <span
                  className="text-xs text-neutral-600 dark:text-neutral-400"
                  title={new Date(set.capturedAt).toLocaleString()}
                >
                  {capturedLabel}
                </span>
                {set.commitSha ? (
                  <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                    {set.commitSha.slice(0, 12).toLowerCase()}
                  </span>
                ) : null}
              </div>

              {set.error ? (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                  {set.error}
                </p>
              ) : null}

              {set.images.length > 0 ? (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {set.images.map((image, indexInSet) => {
                    const displayName = image.fileName ?? "Screenshot";
                    const flatEntry = flattenedImages.find(
                      (entry) =>
                        entry.setId === set._id &&
                        entry.indexInSet === indexInSet
                    );
                    const key =
                      flatEntry?.key ??
                      `${set._id}:${image.storageId}:${indexInSet}`;

                    if (!image.url) {
                      return (
                        <div
                          key={key}
                          className="flex h-36 w-48 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-100 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
                        >
                          URL expired
                        </div>
                      );
                    }

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActiveKey(key)}
                        className="group relative flex w-48 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-left shadow-sm transition hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <img
                          src={image.url}
                          alt={displayName}
                          className="h-36 w-full bg-neutral-50 object-contain dark:bg-neutral-950"
                          loading="lazy"
                          decoding="async"
                        />
                        <div className="pointer-events-none absolute top-2 right-2 rounded-full bg-neutral-900/70 p-1 text-white opacity-0 transition group-hover:opacity-100 dark:bg-neutral-800/90">
                          <Maximize2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="border-t border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                          {displayName}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {set.status === "failed"
                    ? "Screenshot capture failed for this run."
                    : set.hasUiChanges === false
                      ? "Model analysis reported no UI changes for this commit."
                      : "No screenshots were saved for this capture."}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {activeEntry ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/70 px-4 py-6">
          <div className="relative flex w-full max-w-5xl flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {activeEntry.image.fileName ?? "Screenshot"}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {formatRelativeTime(activeEntry.capturedAt)}
                  {activeEntry.image.description
                    ? ` • ${activeEntry.image.description}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {flattenedImages.length > 1 ? (
                  <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                    <button
                      type="button"
                      onClick={goPrev}
                      className="rounded-full p-1 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-neutral-700"
                      aria-label="Previous screenshot"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[3rem] text-center tabular-nums">
                      {activeIndex + 1} / {flattenedImages.length}
                    </span>
                    <button
                      type="button"
                      onClick={goNext}
                      className="rounded-full p-1 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-neutral-700"
                      aria-label="Next screenshot"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={closeOverlay}
                  className="rounded-full p-1.5 text-neutral-600 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900">
              <img
                src={activeEntry.image.url}
                alt={activeEntry.image.fileName ?? "Screenshot"}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
