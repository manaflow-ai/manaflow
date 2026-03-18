import { z } from "zod";

export const MobilePresenceStatusSchema = z.enum([
  "online",
  "offline",
  "unknown",
]);

export const MobilePushEnvironmentSchema = z.enum([
  "development",
  "production",
]);

export const MobileWorkspaceHeartbeatRowSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string().optional(),
  taskRunId: z.string().optional(),
  title: z.string(),
  preview: z.string().optional(),
  phase: z.string(),
  tmuxSessionName: z.string(),
  lastActivityAt: z.number(),
  latestEventSeq: z.number(),
  lastEventAt: z.number().optional(),
});

export const MobileHeartbeatDirectConnectSchema = z.object({
  directPort: z.number(),
  directTlsPins: z.array(z.string()),
  ticketSecret: z.string(),
});

export const MobileMachineSessionRequestSchema = z.object({
  teamSlugOrId: z.string(),
  machineId: z.string(),
  displayName: z.string().optional(),
});

export const MobileMachineSessionResponseSchema = z.object({
  token: z.string(),
  teamId: z.string(),
  userId: z.string(),
  machineId: z.string(),
  expiresAt: z.number(),
});

export const MobileHeartbeatPayloadSchema = z.object({
  machineId: z.string(),
  displayName: z.string(),
  tailscaleHostname: z.string().optional(),
  tailscaleIPs: z.array(z.string()),
  status: MobilePresenceStatusSchema,
  lastSeenAt: z.number().optional(),
  lastWorkspaceSyncAt: z.number().optional(),
  directConnect: MobileHeartbeatDirectConnectSchema.optional(),
  workspaces: z.array(MobileWorkspaceHeartbeatRowSchema),
});

export const MobileOkResponseSchema = z.object({
  ok: z.literal(true),
});

export const MobileAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
});

export const MobileMarkReadRequestSchema = z.object({
  teamSlugOrId: z.string(),
  workspaceId: z.string(),
  latestEventSeq: z.number().optional(),
});

export const MobilePushRegisterRequestSchema = z.object({
  token: z.string(),
  environment: MobilePushEnvironmentSchema,
  platform: z.string(),
  bundleId: z.string(),
  deviceId: z.string().optional(),
});

export const MobilePushRemoveRequestSchema = z.object({
  token: z.string(),
});

export const MobilePushTestRequestSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export const MobilePushTestResponseSchema = z.object({
  scheduledCount: z.number().int().nonnegative(),
});

export const DaemonTicketRequestSchema = z.object({
  server_id: z.string(),
  team_id: z.string(),
  session_id: z.string().optional(),
  attachment_id: z.string().optional(),
  capabilities: z.array(z.string()).default(["session.attach"]),
});

export const DaemonTicketResponseSchema = z.object({
  ticket: z.string(),
  direct_url: z.string(),
  direct_tls_pins: z.array(z.string()),
  session_id: z.string(),
  attachment_id: z.string(),
  expires_at: z.string(),
});

export type MobileMachineSessionRequest = z.infer<
  typeof MobileMachineSessionRequestSchema
>;
export type MobileMachineSessionResponse = z.infer<
  typeof MobileMachineSessionResponseSchema
>;
export type MobileWorkspaceHeartbeatRow = z.infer<
  typeof MobileWorkspaceHeartbeatRowSchema
>;
export type MobileHeartbeatDirectConnect = z.infer<
  typeof MobileHeartbeatDirectConnectSchema
>;
export type MobileHeartbeatPayload = z.infer<
  typeof MobileHeartbeatPayloadSchema
>;
export type MobileMarkReadRequest = z.infer<typeof MobileMarkReadRequestSchema>;
export type MobilePushRegisterRequest = z.infer<
  typeof MobilePushRegisterRequestSchema
>;
export type MobilePushRemoveRequest = z.infer<
  typeof MobilePushRemoveRequestSchema
>;
export type MobilePushTestRequest = z.infer<typeof MobilePushTestRequestSchema>;
export type MobilePushTestResponse = z.infer<
  typeof MobilePushTestResponseSchema
>;
export type DaemonTicketRequest = z.infer<typeof DaemonTicketRequestSchema>;
export type DaemonTicketResponse = z.infer<typeof DaemonTicketResponseSchema>;
