import { DEFAULT_MORPH_SNAPSHOT_ID, TASK_MORPH_SNAPSHOT_ID } from "@/lib/utils/morph-defaults";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { HTTPException } from "hono/http-exception";

import type { getConvex } from "@/lib/utils/get-convex";

export type ConvexClient = ReturnType<typeof getConvex>;

export interface SnapshotResolution {
  team: Awaited<ReturnType<typeof verifyTeamAccess>>;
  resolvedSnapshotId: string;
  environmentDataVaultKey?: string;
  environmentMaintenanceScript?: string;
  environmentDevScript?: string;
}

export const resolveTeamAndSnapshot = async ({
  req,
  convex,
  teamSlugOrId,
  environmentId,
  snapshotId,
  isTaskRun,
}: {
  req: Request;
  convex: ConvexClient;
  teamSlugOrId: string;
  environmentId?: string;
  snapshotId?: string;
  /** When true, uses the performance snapshot for task runs */
  isTaskRun?: boolean;
}): Promise<SnapshotResolution> => {
  const team = await verifyTeamAccess({ req, teamSlugOrId });

  if (environmentId) {
    const environmentDoc = await convex.query(api.environments.get, {
      teamSlugOrId,
      id: typedZid("environments").parse(environmentId),
    });

    if (!environmentDoc) {
      throw new HTTPException(403, {
        message: "Environment not found or not accessible",
      });
    }

    return {
      team,
      resolvedSnapshotId:
        environmentDoc.morphSnapshotId || DEFAULT_MORPH_SNAPSHOT_ID,
      environmentDataVaultKey: environmentDoc.dataVaultKey ?? undefined,
      environmentMaintenanceScript: environmentDoc.maintenanceScript ?? undefined,
      environmentDevScript: environmentDoc.devScript ?? undefined,
    };
  }

  if (snapshotId) {
    const environments = await convex.query(api.environments.list, {
      teamSlugOrId,
    });
    const matchedEnvironment = environments.find(
      (environment) => environment.morphSnapshotId === snapshotId
    );

    if (matchedEnvironment) {
      return {
        team,
        resolvedSnapshotId:
          matchedEnvironment.morphSnapshotId || DEFAULT_MORPH_SNAPSHOT_ID,
      };
    }

    const snapshotVersion = await convex.query(
      api.environmentSnapshots.findBySnapshotId,
      { teamSlugOrId, snapshotId }
    );

    if (!snapshotVersion) {
      throw new HTTPException(403, {
        message: "Forbidden: Snapshot does not belong to this team",
      });
    }

    return {
      team,
      resolvedSnapshotId:
        snapshotVersion.morphSnapshotId || DEFAULT_MORPH_SNAPSHOT_ID,
    };
  }

  // Use performance snapshot for task runs, default for other sandboxes
  const defaultSnapshotId = isTaskRun ? TASK_MORPH_SNAPSHOT_ID : DEFAULT_MORPH_SNAPSHOT_ID;

  return {
    team,
    resolvedSnapshotId: defaultSnapshotId,
  };
};
