import clsx from "clsx";
import type { ReactNode } from "react";
import type { WorkspaceConfigStep } from "../../environment-flow/types";

interface StepItem {
  id: WorkspaceConfigStep;
  label: string;
  description?: string;
}

const DEFAULT_STEPS: StepItem[] = [
  { id: "scripts", label: "Scripts", description: "Review scripts configuration" },
  { id: "env-vars", label: "Environment Variables", description: "Review and update env vars" },
  { id: "run-scripts", label: "Run Scripts", description: "Execute scripts in VS Code terminal" },
  { id: "browser-setup", label: "Browser Setup", description: "Configure browser for auth" },
];

interface WorkspaceConfigLayoutProps {
  /** Current active step */
  currentStep: WorkspaceConfigStep;
  /** Callback when step changes */
  onStepChange?: (step: WorkspaceConfigStep) => void;
  /** Completed steps */
  completedSteps?: Set<WorkspaceConfigStep>;
  /** Sidebar content (step list rendered by default) */
  sidebarContent?: ReactNode;
  /** Custom step items */
  steps?: StepItem[];
  /** Main content area */
  children: ReactNode;
  /** Preview panel content (iframe, VNC, etc.) */
  previewContent?: ReactNode;
  /** Preview panel position */
  previewPosition?: "right" | "bottom";
  /** Initial split ratio (0-1) */
  splitRatio?: number;
  /** Callback when split ratio changes */
  onSplitRatioChange?: (ratio: number) => void;
  /** Header content */
  header?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** CSS class name */
  className?: string;
}

function StepBadge({
  step,
  done,
  isActive,
}: {
  step: number;
  done: boolean;
  isActive: boolean;
}) {
  return (
    <span
      className={clsx(
        "flex h-6 w-6 items-center justify-center rounded-full border text-xs transition-colors",
        done
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/70 dark:bg-emerald-900/40 dark:text-emerald-100"
          : isActive
            ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
            : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      )}
    >
      {done ? "✓" : step}
    </span>
  );
}

/**
 * Layout for the workspace configuration phase
 * Split view with sidebar steps, main content, and preview panel
 */
export function WorkspaceConfigLayout({
  currentStep,
  onStepChange,
  completedSteps = new Set(),
  sidebarContent,
  steps = DEFAULT_STEPS,
  children,
  previewContent,
  previewPosition = "right",
  splitRatio = 0.5,
  onSplitRatioChange,
  header,
  footer,
  className,
}: WorkspaceConfigLayoutProps) {
  // Render default step list if no custom sidebar provided
  const defaultSidebar = (
    <div className="flex flex-col gap-1 p-4">
      {steps.map((step, index) => {
        const isDone = completedSteps.has(step.id);
        const isActive = currentStep === step.id;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepChange?.(step.id)}
            className={clsx(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
              isActive
                ? "bg-neutral-100 dark:bg-neutral-800"
                : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
            )}
          >
            <StepBadge step={index + 1} done={isDone} isActive={isActive} />
            <div className="flex-1 min-w-0">
              <div
                className={clsx(
                  "text-sm font-medium truncate",
                  isActive
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-600 dark:text-neutral-400"
                )}
              >
                {step.label}
              </div>
              {step.description && (
                <div className="text-xs text-neutral-400 truncate mt-0.5">
                  {step.description}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  const isHorizontalSplit = previewPosition === "right";

  return (
    <div className={clsx("h-full flex flex-col", className)}>
      {header && (
        <div className="border-b border-neutral-200 dark:border-neutral-800">
          {header}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 overflow-y-auto bg-white dark:bg-neutral-950">
          {sidebarContent ?? defaultSidebar}
        </div>

        {/* Main content + preview */}
        <div
          className={clsx(
            "flex-1 flex overflow-hidden",
            isHorizontalSplit ? "flex-row" : "flex-col"
          )}
        >
          {/* Main content */}
          <div
            className="overflow-auto bg-white dark:bg-neutral-950"
            style={{
              [isHorizontalSplit ? "width" : "height"]: `${splitRatio * 100}%`,
            }}
          >
            {children}
          </div>

          {/* Resize handle */}
          {previewContent && (
            <div
              className={clsx(
                "shrink-0 bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors",
                isHorizontalSplit
                  ? "w-1 cursor-col-resize"
                  : "h-1 cursor-row-resize"
              )}
              onMouseDown={(e) => {
                if (!onSplitRatioChange) return;
                e.preventDefault();
                const startPos = isHorizontalSplit ? e.clientX : e.clientY;
                const startRatio = splitRatio;
                const container = e.currentTarget.parentElement;
                if (!container) return;
                const containerSize = isHorizontalSplit
                  ? container.clientWidth
                  : container.clientHeight;

                const handleMouseMove = (moveE: MouseEvent) => {
                  const currentPos = isHorizontalSplit
                    ? moveE.clientX
                    : moveE.clientY;
                  const delta = currentPos - startPos;
                  const deltaRatio = delta / containerSize;
                  const newRatio = Math.min(
                    0.8,
                    Math.max(0.2, startRatio + deltaRatio)
                  );
                  onSplitRatioChange(newRatio);
                };

                const handleMouseUp = () => {
                  document.removeEventListener("mousemove", handleMouseMove);
                  document.removeEventListener("mouseup", handleMouseUp);
                };

                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);
              }}
            />
          )}

          {/* Preview panel */}
          {previewContent && (
            <div
              className="overflow-hidden bg-neutral-900"
              style={{
                [isHorizontalSplit ? "width" : "height"]: `${(1 - splitRatio) * 100}%`,
              }}
            >
              {previewContent}
            </div>
          )}
        </div>
      </div>

      {footer && (
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          {footer}
        </div>
      )}
    </div>
  );
}

export default WorkspaceConfigLayout;
