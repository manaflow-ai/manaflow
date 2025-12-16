import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export type ReviewCompletionNotificationCardState =
  | {
      kind: "prompt";
      isRequesting: boolean;
      onEnable: () => void;
    }
  | {
      kind: "enabled";
      onDisable: () => void;
    }
  | {
      kind: "blocked";
    };

type ReviewCompletionNotificationCardProps = {
  state: ReviewCompletionNotificationCardState;
};

export function ReviewCompletionNotificationCard({
  state,
}: ReviewCompletionNotificationCardProps) {
  let message: string;
  let action: ReactNode = null;

  switch (state.kind) {
    case "prompt":
      message = "Get a heads-up when automated review wraps up.";
      action = (
        <Button
          variant="ghost"
          size="sm"
          className="rounded-none border border-neutral-200/70 text-neutral-600"
          onClick={state.onEnable}
          disabled={state.isRequesting}
        >
          {state.isRequesting ? "Requesting..." : "Enable notifications"}
        </Button>
      );
      break;
    case "enabled":
      message = "We will let you know once the review finishes.";
      action = (
        <Button
          variant="ghost"
          size="sm"
          className="rounded-none border border-neutral-200/70 text-neutral-600"
          onClick={state.onDisable}
        >
          Turn off notifications
        </Button>
      );
      break;
    case "blocked":
      message =
        "Notifications are blocked. Update your browser settings to enable them.";
      break;
  }

  return (
    <div className="border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center">
          <span className="leading-tight">{message}</span>
        </div>
        {action}
      </div>
    </div>
  );
}
