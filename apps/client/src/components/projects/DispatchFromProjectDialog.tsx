import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "convex/react";
import { api } from "@cmux/convex/api";
import { Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ProjectItem } from "@cmux/www-openapi-client";

interface DispatchFromProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamSlugOrId: string;
  installationId: number;
  projectId: string;
  owner: string;
  ownerType: string;
  item: ProjectItem | null;
}

export function DispatchFromProjectDialog({
  open,
  onOpenChange,
  teamSlugOrId,
  installationId,
  projectId,
  owner,
  ownerType,
  item,
}: DispatchFromProjectDialogProps) {
  const [repo, setRepo] = useState("");
  const [agents, setAgents] = useState("claude/opus-4.6");
  const [isCreating, setIsCreating] = useState(false);

  const createTask = useMutation(api.tasks.create);

  const title = item?.content?.title ?? "(untitled)";
  const body =
    item?.content && "body" in item.content
      ? (item.content as { body?: string }).body ?? ""
      : "";

  const handleCreate = async () => {
    if (!item) return;

    const agentList = agents
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (agentList.length === 0) {
      toast.error("At least one agent is required");
      return;
    }

    // Compose prompt from title + body
    let prompt = title;
    if (body.trim()) {
      prompt += `\n\n${body}`;
    }

    setIsCreating(true);
    try {
      await createTask({
        teamSlugOrId,
        text: prompt,
        projectFullName: repo || undefined,
        baseBranch: "main",
        selectedAgents: agentList,
        githubProjectId: projectId,
        githubProjectItemId: item.id,
        githubProjectInstallationId: installationId,
        githubProjectOwner: owner,
        githubProjectOwnerType: ownerType,
      });

      toast.success(`Task created: ${title}`, {
        description: `${agentList.length} agent(s) queued. Open dashboard to start sandboxes.`,
      });
      onOpenChange(false);

      // Reset form
      setRepo("");
      setAgents("claude/opus-4.6");
    } catch (err) {
      console.error("[DispatchFromProject] Failed to create task:", err);
      toast.error(
        `Failed to create task: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <Dialog.Title className="text-lg font-semibold mb-4">
            Dispatch as Task
          </Dialog.Title>

          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </Dialog.Close>

          <div className="space-y-4">
            {/* Item preview */}
            <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
              <p className="font-medium text-sm">{title}</p>
              {body && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-3">
                  {body}
                </p>
              )}
            </div>

            {/* Repository */}
            <div>
              <label
                htmlFor="dispatch-repo"
                className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300"
              >
                Repository (owner/name)
              </label>
              <input
                id="dispatch-repo"
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="e.g. karlorz/testing-repo-1"
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Agents */}
            <div>
              <label
                htmlFor="dispatch-agents"
                className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300"
              >
                Agent(s)
              </label>
              <input
                id="dispatch-agents"
                type="text"
                value={agents}
                onChange={(e) => setAgents(e.target.value)}
                placeholder="claude/opus-4.6, codex/gpt-5.3-codex-xhigh"
                className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Comma-separated. Task runs are created for each agent.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={isCreating || !item}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Create Task
                  </>
                )}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
