import { z } from "zod";

export const MobileAnalyticsEventNameSchema = z.enum([
  "mobile_machine_session_issued",
  "mobile_heartbeat_ingested",
  "mobile_workspace_snapshot_ingested",
  "mobile_workspace_opened",
  "mobile_workspace_mark_read",
  "mobile_push_registered",
  "mobile_push_removed",
  "mobile_push_test_sent",
  "mobile_push_opened",
  "mobile_daemon_ticket_issued",
  "mobile_daemon_attach_result",
  "ios_grdb_boot_completed",
]);

export const MobileAnalyticsTeamKindSchema = z.enum(["personal", "shared"]);

export const MobileAnalyticsPropertiesSchema = z.object({
  teamId: z.string().optional(),
  teamKind: MobileAnalyticsTeamKindSchema.optional(),
  userId: z.string().optional(),
  machineId: z.string().optional(),
  workspaceId: z.string().optional(),
  platform: z.string().optional(),
  bundleId: z.string().optional(),
  source: z.string().optional(),
  result: z.string().optional(),
  errorCode: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  cacheAgeMs: z.number().nonnegative().optional(),
  workspaceCount: z.number().int().nonnegative().optional(),
  unreadCount: z.number().int().nonnegative().optional(),
});

export const MobileAnalyticsCaptureRequestSchema = z.object({
  event: MobileAnalyticsEventNameSchema,
  properties: MobileAnalyticsPropertiesSchema.default({}),
});

export type MobileAnalyticsEventName = z.infer<
  typeof MobileAnalyticsEventNameSchema
>;
export type MobileAnalyticsTeamKind = z.infer<
  typeof MobileAnalyticsTeamKindSchema
>;
export type MobileAnalyticsProperties = z.infer<
  typeof MobileAnalyticsPropertiesSchema
>;
export type MobileAnalyticsCaptureRequest = z.infer<
  typeof MobileAnalyticsCaptureRequestSchema
>;
