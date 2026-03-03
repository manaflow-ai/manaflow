import { useState, useCallback } from "react";
import { DispatchFromProjectDialog } from "@/components/projects/DispatchFromProjectDialog";
import { PlanImportDialog } from "@/components/projects/PlanImportDialog";
import { ProjectItemsView } from "@/components/projects/ProjectItemsView";
import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import {
  getApiIntegrationsGithubProjectsItems,
  getApiIntegrationsGithubProjectsFields,
} from "@cmux/www-openapi-client";
import type {
  ProjectItem,
  ProjectField,
} from "@cmux/www-openapi-client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, FileUp } from "lucide-react";
import { z } from "zod";

const projectDetailSearch = z.object({
  installationId: z.coerce.number(),
  owner: z.string(),
  ownerType: z.enum(["user", "organization"]),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/projects/$projectId",
)({
  component: ProjectDetailPage,
  validateSearch: projectDetailSearch,
});

function ProjectDetailPage() {
  const { teamSlugOrId, projectId } = Route.useParams();
  const { installationId, owner, ownerType } = Route.useSearch();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchItem, setDispatchItem] = useState<ProjectItem | null>(null);

  // Accumulated items from pagination
  const [allItems, setAllItems] = useState<ProjectItem[]>([]);
  const [pageInfo, setPageInfo] = useState<{
    hasNextPage: boolean;
    endCursor: string | null;
  }>({ hasNextPage: false, endCursor: null });
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Fetch project fields
  const { data: fieldsData, isLoading: fieldsLoading } = useQuery({
    queryKey: [
      "github-project-fields",
      teamSlugOrId,
      installationId,
      projectId,
    ],
    queryFn: async () => {
      const res = await getApiIntegrationsGithubProjectsFields({
        query: { team: teamSlugOrId, installationId, projectId },
      });
      return res.data ?? { fields: [] };
    },
  });

  // Fetch initial project items
  const { isLoading: itemsLoading } = useQuery({
    queryKey: [
      "github-project-items",
      teamSlugOrId,
      installationId,
      projectId,
    ],
    queryFn: async () => {
      const res = await getApiIntegrationsGithubProjectsItems({
        query: {
          team: teamSlugOrId,
          installationId,
          projectId,
          first: 50,
        },
      });
      const data = res.data ?? {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      setAllItems(data.items);
      setPageInfo(data.pageInfo);
      return data;
    },
  });

  const handleLoadMore = useCallback(
    async (cursor: string) => {
      setIsLoadingMore(true);
      try {
        const res = await getApiIntegrationsGithubProjectsItems({
          query: {
            team: teamSlugOrId,
            installationId,
            projectId,
            first: 50,
            after: cursor,
          },
        });
        const data = res.data;
        if (data) {
          setAllItems((prev) => [...prev, ...data.items]);
          setPageInfo(data.pageInfo);
        }
      } catch (err) {
        console.error("[ProjectDetail] Failed to load more items:", err);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [teamSlugOrId, installationId, projectId],
  );

  const fields: ProjectField[] = fieldsData?.fields ?? [];
  const isLoading = fieldsLoading || itemsLoading;

  // Build project URL from owner info
  const projectUrl =
    ownerType === "organization"
      ? `https://github.com/orgs/${owner}/projects`
      : `https://github.com/users/${owner}/projects`;

  return (
    <FloatingPane header={<TitleBar title="Project Items" />}>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/$teamSlugOrId/projects"
                params={{ teamSlugOrId }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Project Items</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {owner} &middot; {allItems.length} item
                {allItems.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
            >
              <FileUp className="h-4 w-4 mr-2" />
              Import Plan
            </Button>
            <Button asChild variant="outline" size="sm">
              <a
                href={projectUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in GitHub
                <ExternalLink className="h-3 w-3 ml-2" />
              </a>
            </Button>
          </div>
        </div>

        {/* Items Table */}
        <ProjectItemsView
          items={allItems}
          fields={fields}
          projectId={projectId}
          projectUrl={projectUrl}
          teamSlugOrId={teamSlugOrId}
          installationId={installationId}
          isLoading={isLoading}
          hasNextPage={pageInfo.hasNextPage}
          endCursor={pageInfo.endCursor}
          onLoadMore={handleLoadMore}
          isLoadingMore={isLoadingMore}
          onDispatchItem={(item) => {
            setDispatchItem(item);
            setDispatchDialogOpen(true);
          }}
        />
      </div>

      <PlanImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        teamSlugOrId={teamSlugOrId}
        installationId={installationId}
        projects={[{ id: projectId, title: "Current Project" }]}
        onImported={() => {
          // Re-fetch items by reloading the page state
          void getApiIntegrationsGithubProjectsItems({
            query: {
              team: teamSlugOrId,
              installationId,
              projectId,
              first: 50,
            },
          }).then((res) => {
            const data = res.data;
            if (data) {
              setAllItems(data.items);
              setPageInfo(data.pageInfo);
            }
          });
        }}
      />

      <DispatchFromProjectDialog
        open={dispatchDialogOpen}
        onOpenChange={setDispatchDialogOpen}
        teamSlugOrId={teamSlugOrId}
        installationId={installationId}
        projectId={projectId}
        owner={owner}
        ownerType={ownerType}
        item={dispatchItem}
      />
    </FloatingPane>
  );
}
