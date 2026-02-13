import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  E2BWebhookEventSchema,
  computeE2BWebhookSignature,
  mapE2BWebhookEventType,
  verifyE2BWebhookSignature,
} from "./e2b-webhook";

describe("e2b webhook helpers", () => {
  it("computes the documented signature format", async () => {
    const secret = "test-secret";
    const payload = '{"id":"evt_123","type":"sandbox.lifecycle.created","sandboxId":"sbx_123"}';
    const expected = createHash("sha256")
      .update(`${secret}${payload}`, "utf8")
      .digest("base64")
      .replace(/=+$/g, "");

    const actual = await computeE2BWebhookSignature(secret, payload);
    expect(actual).toBe(expected);
  });

  it("verifies a valid signature header", async () => {
    const secret = "test-secret";
    const payload = '{"id":"evt_123","type":"sandbox.lifecycle.created","sandboxId":"sbx_123"}';
    const signatureHeader = await computeE2BWebhookSignature(secret, payload);

    const ok = await verifyE2BWebhookSignature({
      secret,
      payload,
      signatureHeader,
    });
    expect(ok).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const secret = "test-secret";
    const signedPayload = '{"id":"evt_123","type":"sandbox.lifecycle.created","sandboxId":"sbx_123"}';
    const tamperedPayload = '{"id":"evt_123","type":"sandbox.lifecycle.killed","sandboxId":"sbx_123"}';
    const signatureHeader = await computeE2BWebhookSignature(secret, signedPayload);

    const ok = await verifyE2BWebhookSignature({
      secret,
      payload: tamperedPayload,
      signatureHeader,
    });
    expect(ok).toBe(false);
  });

  it("maps lifecycle events to instance state transitions", () => {
    expect(mapE2BWebhookEventType("sandbox.lifecycle.created")).toEqual({
      status: "running",
      activity: "resume",
    });
    expect(mapE2BWebhookEventType("sandbox.lifecycle.resumed")).toEqual({
      status: "running",
      activity: "resume",
    });
    expect(mapE2BWebhookEventType("sandbox.lifecycle.paused")).toEqual({
      status: "paused",
      activity: "pause",
    });
    expect(mapE2BWebhookEventType("sandbox.lifecycle.killed")).toEqual({
      status: "stopped",
      activity: "stop",
    });
    expect(mapE2BWebhookEventType("sandbox.lifecycle.timeout")).toEqual({
      status: "stopped",
      activity: "stop",
    });
    expect(mapE2BWebhookEventType("sandbox.lifecycle.updated")).toEqual({
      status: null,
      activity: null,
    });
    expect(mapE2BWebhookEventType("ping")).toBeNull();
  });

  it("parses a valid E2B lifecycle payload", () => {
    const event = E2BWebhookEventSchema.parse({
      id: "evt_123",
      timestamp: "2026-02-13T11:12:13.456Z",
      type: "sandbox.lifecycle.created",
      sandboxId: "sbx_123",
      eventData: {
        metadata: {
          app: "cmux-devbox-v2",
        },
      },
    });
    expect(event.sandboxId).toBe("sbx_123");
  });

  it("allows ping payloads without sandboxId", () => {
    const event = E2BWebhookEventSchema.parse({
      id: "evt_ping",
      timestamp: "2026-02-13T11:12:13.456Z",
      type: "ping",
    });
    expect(event.type).toBe("ping");
    expect(event.sandboxId).toBeUndefined();
  });
});
