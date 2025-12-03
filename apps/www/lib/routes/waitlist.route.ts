import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";
import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { decodeJwt } from "jose";

export const waitlistRouter = new OpenAPIHono();

const WaitlistRequestSchema = z
  .object({
    email: z
      .string()
      .email()
      .openapi({ description: "Email address for follow-ups", example: "dev@example.com" }),
    provider: z
      .enum(["gitlab", "bitbucket"])
      .openapi({ description: "Git provider the user wants support for" }),
    context: z
      .string()
      .optional()
      .openapi({ description: "Where the waitlist request originated (e.g. preview page)" }),
    repoUrl: z
      .string()
      .optional()
      .openapi({ description: "Original repository URL the user provided" }),
    notes: z
      .string()
      .optional()
      .openapi({ description: "Optional notes or additional context from the user" }),
  })
  .openapi("WaitlistRequest");

const WaitlistResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("WaitlistResponse");

waitlistRouter.openapi(
  createRoute({
    method: "post",
    path: "/waitlist/git-provider",
    tags: ["Waitlist"],
    summary: "Capture interest in GitLab/Bitbucket support",
    request: {
      body: {
        content: {
          "application/json": {
            schema: WaitlistRequestSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Recorded waitlist submission",
        content: {
          "application/json": {
            schema: WaitlistResponseSchema,
          },
        },
      },
      422: { description: "Validation error" },
    },
  }),
  async (c) => {
    const payload = c.req.valid("json");

    // Enrich event with Stack user ID when available (best-effort)
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    let userId: string | undefined;
    if (accessToken) {
      try {
        const decoded = decodeJwt(accessToken);
        userId = typeof decoded.sub === "string" ? decoded.sub : undefined;
      } catch (error) {
        console.warn("[waitlist] Failed to decode access token", error);
      }
    }

    try {
      await captureServerPosthogEvent({
        distinctId: payload.email.toLowerCase(),
        event: "waitlist_git_provider",
        properties: {
          provider: payload.provider,
          context: payload.context ?? null,
          repo_url: payload.repoUrl ?? null,
          notes: payload.notes ?? null,
          user_id: userId ?? null,
          user_agent: c.req.header("user-agent") ?? null,
        },
      });
    } catch (error) {
      console.error("[waitlist] Failed to capture waitlist submission", error);
    }

    return c.json({ ok: true });
  },
);
