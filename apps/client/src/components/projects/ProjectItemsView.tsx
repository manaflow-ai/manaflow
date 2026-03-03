import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  patchApiIntegrationsGithubProjectsItemsField,
} from "@cmux/www-openapi-client";
import type {
  ProjectItem,
  ProjectField,
} from "@cmux/www-openapi-client";
import {
  CircleDot,
  FileText,
  GitPullRequest,
  ExternalLink,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function getItemType(item: ProjectItem): "Issue" | "PR" | "Draft" {
  if (!item.content) return "Draft";
  if (item.content.url?.includes("/pull/")) return "PR";
  if (item.content.state) return "Issue";
  return "Draft";
}

function TypeIcon({ type }: { type: "Issue" | "PR" | "Draft" }) {
  switch (type) {
    case "Issue":
      return <CircleDot className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case "PR":
      return <GitPullRequest className="h-4 w-4 text-purple-600 dark:text-purple-400" />;
    case "Draft":
      return <FileText className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />;
  }
}

function TypeBadge({ type }: { type: "Issue" | "PR" | "Draft" }) {
  const colorMap = {
    Issue:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    PR: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    Draft:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorMap[type]}`}
    >
      {type}
    </span>
  );
}

interface StatusCellProps {
  item: ProjectItem;
  projectId: string;
  fields: ProjectField[];
  teamSlugOrId: string;
  installationId: number;
}

function StatusCell({
  item,
  projectId,
  fields,
  teamSlugOrId,
  installationId,
}: StatusCellProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const statusField = fields.find(
    (f) => f.name === "Status" && f.options && f.options.length > 0,
  );

  const currentStatus =
    typeof item.fieldValues.Status === "string"
      ? item.fieldValues.Status
      : null;

  const updateMutation = useMutation({
    mutationFn: async (optionId: string) => {
      if (!statusField) return;
      await patchApiIntegrationsGithubProjectsItemsField({
        query: { team: teamSlugOrId, installationId },
        body: {
          projectId,
          itemId: item.id,
          fieldId: statusField.id,
          value: { singleSelectOptionId: optionId },
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["github-project-items", teamSlugOrId, installationId, projectId],
      });
    },
    onError: (err) => {
      console.error("[ProjectItemsView] Failed to update status:", err);
    },
  });

  if (!statusField?.options || statusField.options.length === 0) {
    return (
      <span className="text-sm text-neutral-500 dark:text-neutral-400">
        {currentStatus ?? "-"}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={updateMutation.isPending}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-sm border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
      >
        {updateMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <>
            {currentStatus ?? "No status"}
            <ChevronDown className="h-3 w-3" />
          </>
        )}
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-1 z-20 min-w-[160px] rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            {statusField.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  updateMutation.mutate(opt.id);
                }}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  currentStatus === opt.name
                    ? "font-medium text-blue-600 dark:text-blue-400"
                    : "text-neutral-700 dark:text-neutral-300"
                }`}
              >
                {opt.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ProjectItemsViewProps {
  items: ProjectItem[];
  fields: ProjectField[];
  projectId: string;
  projectUrl?: string;
  teamSlugOrId: string;
  installationId: number;
  isLoading: boolean;
  hasNextPage: boolean;
  endCursor: string | null;
  onLoadMore: (cursor: string) => void;
  isLoadingMore: boolean;
}

export function ProjectItemsView({
  items,
  fields,
  projectId,
  projectUrl,
  teamSlugOrId,
  installationId,
  isLoading,
  hasNextPage,
  endCursor,
  onLoadMore,
  isLoadingMore,
}: ProjectItemsViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <FileText className="h-12 w-12 text-neutral-400 mb-4" />
        <h3 className="text-lg font-medium mb-2 text-neutral-700 dark:text-neutral-300">
          No items in this project
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-4">
          Add issues, pull requests, or draft issues to this project to see them
          here.
        </p>
        {projectUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={projectUrl} target="_blank" rel="noopener noreferrer">
              Open in GitHub
              <ExternalLink className="h-3 w-3 ml-2" />
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="text-left py-2 px-4 font-medium text-neutral-500 dark:text-neutral-400">
                Title
              </th>
              <th className="text-left py-2 px-4 font-medium text-neutral-500 dark:text-neutral-400">
                Type
              </th>
              <th className="text-left py-2 px-4 font-medium text-neutral-500 dark:text-neutral-400">
                Status
              </th>
              <th className="text-right py-2 px-4 font-medium text-neutral-500 dark:text-neutral-400">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const type = getItemType(item);
              const title = item.content?.title ?? "(untitled)";
              const url = item.content?.url;

              return (
                <tr
                  key={item.id}
                  className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30"
                >
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <TypeIcon type={type} />
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          {title}
                        </a>
                      ) : (
                        <span className="truncate">{title}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-4">
                    <TypeBadge type={type} />
                  </td>
                  <td className="py-2 px-4">
                    <StatusCell
                      item={item}
                      projectId={projectId}
                      fields={fields}
                      teamSlugOrId={teamSlugOrId}
                      installationId={installationId}
                    />
                  </td>
                  <td className="py-2 px-4 text-right text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    {typeof item.fieldValues["Updated"] === "string"
                      ? getTimeAgo(new Date(item.fieldValues["Updated"] as string))
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasNextPage && endCursor && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onLoadMore(endCursor)}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
