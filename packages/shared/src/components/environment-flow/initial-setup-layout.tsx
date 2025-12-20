import clsx from "clsx";
import type { ReactNode } from "react";

interface InitialSetupLayoutProps {
  /** Title for the setup page */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Main content (form sections) */
  children: ReactNode;
  /** Primary action button (e.g., Continue) */
  primaryButton?: ReactNode;
  /** Back button */
  backButton?: ReactNode;
  /** Side content (e.g., preview or info panel) */
  sideContent?: ReactNode;
  /** Whether to show side content */
  showSideContent?: boolean;
  /** CSS class name */
  className?: string;
}

/**
 * Layout for the initial setup phase of the environment flow
 * Full-page form layout with optional side content
 */
export function InitialSetupLayout({
  title,
  subtitle,
  children,
  primaryButton,
  backButton,
  sideContent,
  showSideContent = false,
  className,
}: InitialSetupLayoutProps) {
  return (
    <div className={clsx("h-full flex", className)}>
      {/* Main content area */}
      <div
        className={clsx(
          "flex flex-col h-full",
          showSideContent ? "flex-1 max-w-2xl" : "flex-1"
        )}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          {backButton && <div className="mb-4">{backButton}</div>}
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </p>
          )}
        </div>

        {/* Scrollable form content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

        {/* Fixed footer with actions */}
        {primaryButton && (
          <div className="p-6 pt-0 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
            <div className="flex items-center gap-3 pt-4">{primaryButton}</div>
          </div>
        )}
      </div>

      {/* Side content area (preview, info, etc.) */}
      {showSideContent && sideContent && (
        <div className="w-96 border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 overflow-auto">
          {sideContent}
        </div>
      )}
    </div>
  );
}

export default InitialSetupLayout;
