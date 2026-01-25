import { memo } from "react";
import { Download, CheckCircle2, AlertCircle, Loader2, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

export type DockerPullStatus = "downloading" | "extracting" | "complete" | "error";

export interface DockerPullToastProps {
  imageName: string;
  status: DockerPullStatus;
  progress?: string;
  progressPercent?: number;
  currentLayer?: number;
  totalLayers?: number;
  error?: string;
}

export const DockerPullToast = memo(function DockerPullToast({
  imageName,
  status,
  progress,
  progressPercent,
  currentLayer,
  totalLayers,
  error,
}: DockerPullToastProps) {
  const isError = status === "error";
  const isComplete = status === "complete";
  const isExtracting = status === "extracting";

  // Format image name for display (show only the last part if it's long)
  const displayImageName = imageName.length > 40
    ? `...${imageName.slice(-37)}`
    : imageName;

  return (
    <div className="flex flex-col gap-2 min-w-[320px]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            isError
              ? "bg-red-500/10 text-red-500"
              : isComplete
                ? "bg-green-500/10 text-green-500"
                : "bg-blue-500/10 text-blue-500"
          )}
        >
          {isError ? (
            <AlertCircle className="h-4 w-4" />
          ) : isComplete ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : isExtracting ? (
            <HardDrive className="h-4 w-4 animate-pulse" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {isError
              ? "Pull failed"
              : isComplete
                ? "Pull complete"
                : isExtracting
                  ? "Extracting image"
                  : "Pulling Docker image"}
          </span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {displayImageName}
          </span>
        </div>
      </div>

      {/* Progress section (not shown for complete/error) */}
      {!isComplete && !isError && (
        <div className="flex flex-col gap-1.5">
          {/* Progress bar */}
          <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300 ease-out",
                isExtracting
                  ? "bg-amber-500"
                  : "bg-blue-500"
              )}
              style={{
                width: `${progressPercent ?? 0}%`,
              }}
            />
          </div>

          {/* Progress details */}
          <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {isExtracting ? "Extracting" : "Downloading"}
              {totalLayers && currentLayer
                ? ` layer ${Math.min(currentLayer, totalLayers)}/${totalLayers}`
                : "..."}
            </span>
            <span className="tabular-nums">
              {progress ?? `${progressPercent ?? 0}%`}
            </span>
          </div>
        </div>
      )}

      {/* Error message */}
      {isError && error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-md px-2.5 py-2 leading-relaxed">
          {error}
        </div>
      )}

      {/* First run hint */}
      {!isComplete && !isError && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 italic">
          First run may take a few minutes depending on your connection.
        </p>
      )}
    </div>
  );
});
