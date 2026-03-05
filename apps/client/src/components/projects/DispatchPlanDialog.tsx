/**
 * DispatchPlanDialog Component
 *
 * Confirmation dialog shown before dispatching a project plan.
 * Shows plan summary (task count, agents) and triggers dispatch mutation.
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Play, AlertTriangle, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { Button } from "@/components/ui/button";
import type { PlanTask } from "./PlanEditor";

interface DispatchPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  tasks: PlanTask[];
  onDispatched?: () => void;
}

export function DispatchPlanDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  tasks,
  onDispatched,
}: DispatchPlanDialogProps) {
  const [error, setError] = useState<string | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: useConvexMutation(api.projectQueries.dispatchPlan),
    onSuccess: () => {
      onOpenChange(false);
      onDispatched?.();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Compute agent summary
  const agentCounts = new Map<string, number>();
  for (const task of tasks) {
    agentCounts.set(task.agentName, (agentCounts.get(task.agentName) ?? 0) + 1);
  }

  const handleDispatch = () => {
    setError(null);
    dispatchMutation.mutate({
      projectId: projectId as Id<"projects">,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <Dialog.Title className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center size-10 rounded-full bg-blue-100 dark:bg-blue-900/30">
              <Play className="size-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 block">
                Dispatch Plan
              </span>
              <span className="text-sm text-neutral-500 dark:text-neutral-400 block">
                {projectName}
              </span>
            </div>
          </Dialog.Title>

          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </Dialog.Close>

          {/* Plan summary */}
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-4 mb-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-400">Total tasks</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{tasks.length}</span>
            </div>
            <div className="space-y-1">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Agents</span>
              {Array.from(agentCounts.entries()).map(([agent, count]) => (
                <div key={agent} className="flex justify-between text-xs pl-2">
                  <span className="font-mono text-neutral-700 dark:text-neutral-300">{agent}</span>
                  <span className="text-neutral-500">{count} task{count > 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 mb-4">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              This will create orchestration tasks and start agent execution. The plan editor will become read-only.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 mb-4">
              <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={dispatchMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={dispatchMutation.isPending || tasks.length === 0}
            >
              {dispatchMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Play className="mr-2 size-4" />
                  Dispatch {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
