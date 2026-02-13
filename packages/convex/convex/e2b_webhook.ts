import { sha256Hex } from "../_shared/crypto";
import {
  type E2BWebhookEvent,
  E2BWebhookEventSchema,
  mapE2BWebhookEventType,
  verifyE2BWebhookSignature,
} from "../_shared/e2b-webhook";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

export const e2bWebhook = httpAction(async (ctx, req) => {
  if (!env.E2B_WEBHOOK_SECRET) {
    return new Response("webhook not configured", { status: 501 });
  }

  const payload = await req.text();
  const signature = req.headers.get("e2b-signature");

  const isValidSignature = await verifyE2BWebhookSignature({
    secret: env.E2B_WEBHOOK_SECRET,
    payload,
    signatureHeader: signature,
  });
  if (!isValidSignature) {
    return new Response("invalid signature", { status: 400 });
  }

  let event: E2BWebhookEvent;
  try {
    event = E2BWebhookEventSchema.parse(JSON.parse(payload));
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  const deliveryId = req.headers.get("e2b-delivery-id") ?? event.id;
  if (deliveryId) {
    const payloadHash = await sha256Hex(payload);
    const result = await ctx.runMutation(internal.github_app.recordWebhookDelivery, {
      provider: "e2b",
      deliveryId: `e2b:${deliveryId}`,
      payloadHash,
    });
    if (!result.created) {
      return new Response("ok (duplicate)", { status: 200 });
    }
  }

  const mappedState = mapE2BWebhookEventType(event.type);
  if (!mappedState) {
    return new Response("ok (ignored)", { status: 200 });
  }

  if (!event.sandboxId) {
    return new Response("invalid payload", { status: 400 });
  }
  const sandboxId = event.sandboxId;

  if (mappedState.status) {
    await ctx.runMutation(internal.devboxInstances.updateStatusInternal, {
      providerInstanceId: sandboxId,
      status: mappedState.status,
    });
  }

  if (mappedState.activity === "resume") {
    await ctx.runMutation(internal.e2bInstances.recordResumeInternal, {
      instanceId: sandboxId,
    });
  } else if (mappedState.activity === "pause") {
    await ctx.runMutation(internal.e2bInstances.recordPauseInternal, {
      instanceId: sandboxId,
    });
  } else if (mappedState.activity === "stop") {
    await ctx.runMutation(internal.e2bInstances.recordStopInternal, {
      instanceId: sandboxId,
    });
  }

  return new Response("ok", { status: 200 });
});
