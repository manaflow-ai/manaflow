import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/"
)({
  parseParams: (params) => ({
    ...params,
    taskRunId: typedZid("taskRuns").parse(params.runId),
  }),
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
      params: {
        teamSlugOrId: params.teamSlugOrId,
        taskId: params.taskId,
        runId: params.taskRunId,
      },
    });
  },
});
