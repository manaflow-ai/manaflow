"use client";

import clsx from "clsx";

export interface BrowserSetupStepProps {
  /**
   * Whether the step is compact (sidebar mode).
   */
  compact?: boolean;
  /**
   * Class name for the container.
   */
  className?: string;
}

export function BrowserSetupStep({
  compact = false,
  className,
}: BrowserSetupStepProps) {
  const textSize = compact ? "text-[11px]" : "text-xs";
  const circleSize = compact ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]";

  return (
    <div className={clsx("space-y-3", className)}>
      <p className={clsx("text-neutral-500 dark:text-neutral-400", textSize)}>
        Use the browser on the right to set up authentication:
      </p>

      <ul className={clsx("space-y-2 text-neutral-600 dark:text-neutral-400", textSize)}>
        <li className="flex items-start gap-2">
          <span
            className={clsx(
              "flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5",
              circleSize
            )}
          >
            1
          </span>
          <span>Sign in to any dashboards or SaaS tools</span>
        </li>
        <li className="flex items-start gap-2">
          <span
            className={clsx(
              "flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5",
              circleSize
            )}
          >
            2
          </span>
          <span>Dismiss cookie banners, popups, or MFA prompts</span>
        </li>
        <li className="flex items-start gap-2">
          <span
            className={clsx(
              "flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5",
              circleSize
            )}
          >
            3
          </span>
          <span>
            Navigate to your dev server URL (e.g., localhost:3000)
          </span>
        </li>
      </ul>

      <p className={clsx("text-neutral-500 dark:text-neutral-400", textSize)}>
        Proceed once browser is set up properly.
      </p>
    </div>
  );
}
