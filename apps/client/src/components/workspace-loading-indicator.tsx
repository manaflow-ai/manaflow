import { memo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceLoadingStatus = "loading" | "error";

type WorkspaceLoadingVariant = "vscode" | "browser" | "terminal";

export interface WorkspaceLoadingIndicatorProps {
  status: WorkspaceLoadingStatus;
  variant?: WorkspaceLoadingVariant;
  className?: string;
  loadingTitle?: string;
  loadingDescription?: string;
  errorTitle?: string;
  errorDescription?: string;
  action?: React.ReactNode;
}

const VARIANT_COPY: Record<
  WorkspaceLoadingVariant,
  {
    loadingTitle: string;
    loadingDescription: string;
    errorTitle: string;
    errorDescription: string;
  }
> = {
  vscode: {
    loadingTitle: "Starting VS Code workspace",
    loadingDescription:
      "Provisioning an isolated editor. This usually takes under a minute.",
    errorTitle: "We couldn't launch VS Code",
    errorDescription: "Refresh the page or try rerunning the task.",
  },
  browser: {
    loadingTitle: "Launching browser preview",
    loadingDescription:
      "Preparing the in-browser environment. Available in cloud workspaces.",
    errorTitle: "We couldn't launch the browser preview",
    errorDescription: "Refresh the page or switch to cloud mode, then try again.",
  },
  terminal: {
    loadingTitle: "Starting terminal",
    loadingDescription: "Connecting to the workspace terminal session.",
    errorTitle: "We couldn't connect to the terminal",
    errorDescription: "Refresh the page or try again.",
  },
};

export const WorkspaceLoadingIndicator = memo(function WorkspaceLoadingIndicator({
  status,
  variant = "vscode",
  className,
  loadingTitle,
  loadingDescription,
  errorTitle,
  errorDescription,
  action,
}: WorkspaceLoadingIndicatorProps) {
  const copy = VARIANT_COPY[variant];
  const isError = status === "error";
  const Icon = isError ? AlertTriangle : Loader2;

  const resolvedTitle = isError
    ? errorTitle ?? copy.errorTitle
    : loadingTitle ?? copy.loadingTitle;

  const resolvedDescription = isError
    ? errorDescription ?? copy.errorDescription
    : loadingDescription ?? copy.loadingDescription;

  return (
    <div className={cn("flex flex-col items-center gap-4 text-center px-6", className)}>
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border-2",
          isError
            ? "border-red-500/30 text-red-500 dark:text-red-400"
            : "border-blue-500/30 text-blue-500 dark:text-blue-400",
        )}
      >
        <Icon className={cn("h-6 w-6", isError ? undefined : "animate-spin")} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {resolvedTitle}
        </p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {resolvedDescription}
        </p>
      </div>
      {action}
    </div>
  );
});
