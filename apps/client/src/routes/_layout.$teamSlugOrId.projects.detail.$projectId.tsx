/**
 * Project Detail Route (cmux Projects)
 *
 * Displays a single project with its PlanEditor, dispatch controls,
 * and live orchestration task tracking.
 */

import { useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import type { Plan } from "@/components/projects/PlanEditor";

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/projects/detail/$projectId"
)({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { teamSlugOrId, projectId } = Route.useParams();

  // Fetch project (reactive)
  const {
    data: project,
    isLoading: projectLoading,
    refetch: refetchProject,
  } = useQuery(
    convexQuery(api.projectQueries.getProject, {
      projectId: projectId as Id<"projects">,
      teamSlugOrId,
    })
  );

  // Fetch live orchestration tasks (reactive)
  const { data: orchTasks = [] } = useQuery(
    convexQuery(api.projectQueries.getOrchestrationTasksForProject, {
      projectId: projectId as Id<"projects">,
    })
  );

  // Save plan mutation
  const upsertPlanMutation = useMutation({
    mutationFn: useConvexMutation(api.projectQueries.upsertPlan),
    onSuccess: () => {
      refetchProject();
    },
  });

  const handleSavePlan = useCallback(
    async (plan: Plan) => {
      await upsertPlanMutation.mutateAsync({
        projectId: projectId as Id<"projects">,
        orchestrationId: plan.orchestrationId,
        headAgent: plan.headAgent,
        description: plan.description,
        tasks: plan.tasks,
      });
    },
    [projectId, upsertPlanMutation]
  );

  const handleDispatchComplete = useCallback(() => {
    refetchProject();
  }, [refetchProject]);

  return (
    <FloatingPane
      header={<TitleBar title={project?.name ?? "Project"} />}
    >
      <div className="p-6 max-w-6xl mx-auto">
        {projectLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-8 animate-spin text-neutral-400" />
          </div>
        ) : !project ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
            <p className="text-lg font-medium">Project not found</p>
          </div>
        ) : (
          <ProjectDetailView
            project={project}
            orchTasks={orchTasks}
            teamSlugOrId={teamSlugOrId}
            onSavePlan={handleSavePlan}
            onDispatchComplete={handleDispatchComplete}
          />
        )}
      </div>
    </FloatingPane>
  );
}
