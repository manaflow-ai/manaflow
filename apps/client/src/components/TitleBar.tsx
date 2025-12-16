import type { CSSProperties, ReactNode } from "react";

export function TitleBar({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="min-h-[24px] border-b border-neutral-200/70 dark:border-neutral-800/50 flex items-center justify-center relative select-none"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      {/* Traffic light placeholder - will be handled by macOS */}
      <div
        className="absolute left-0 w-20 h-full"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      />

      {/* Title */}
      <div className="flex items-center text-xs font-medium text-neutral-900 dark:text-neutral-100">
        <span>{title}</span>
      </div>

      {actions ? (
        <div
          className="absolute inset-y-0 right-3 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
