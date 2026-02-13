import { z } from "zod";
import { base64FromBytes } from "./encoding";

const E2B_LIFECYCLE_TO_STATE = {
  "sandbox.lifecycle.created": {
    status: "running",
    activity: "resume",
  },
  "sandbox.lifecycle.resumed": {
    status: "running",
    activity: "resume",
  },
  "sandbox.lifecycle.paused": {
    status: "paused",
    activity: "pause",
  },
  "sandbox.lifecycle.killed": {
    status: "stopped",
    activity: "stop",
  },
  "sandbox.lifecycle.timeout": {
    status: "stopped",
    activity: "stop",
  },
  "sandbox.lifecycle.updated": {
    status: null,
    activity: null,
  },
} as const;

export const E2BWebhookEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  sandboxId: z.string().optional(),
  eventData: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type E2BWebhookEvent = z.infer<typeof E2BWebhookEventSchema>;
export type E2BWebhookLifecycleType = keyof typeof E2B_LIFECYCLE_TO_STATE;
export type E2BWebhookMappedState =
  (typeof E2B_LIFECYCLE_TO_STATE)[E2BWebhookLifecycleType];

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export async function computeE2BWebhookSignature(
  secret: string,
  payload: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${secret}${payload}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64FromBytes(digest).replace(/=+$/g, "");
}

export async function verifyE2BWebhookSignature(args: {
  secret: string;
  payload: string;
  signatureHeader: string | null;
}): Promise<boolean> {
  const signature = args.signatureHeader?.trim();
  if (!signature) return false;
  const expected = await computeE2BWebhookSignature(args.secret, args.payload);
  return safeEqualString(expected, signature);
}

export function mapE2BWebhookEventType(
  eventType: string,
): E2BWebhookMappedState | null {
  switch (eventType) {
    case "sandbox.lifecycle.created":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.created"];
    case "sandbox.lifecycle.resumed":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.resumed"];
    case "sandbox.lifecycle.paused":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.paused"];
    case "sandbox.lifecycle.killed":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.killed"];
    case "sandbox.lifecycle.timeout":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.timeout"];
    case "sandbox.lifecycle.updated":
      return E2B_LIFECYCLE_TO_STATE["sandbox.lifecycle.updated"];
    default:
      return null;
  }
}
