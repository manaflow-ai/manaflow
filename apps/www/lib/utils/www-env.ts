import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "NEXT_PUBLIC_",
  server: {
    // Stack server-side env
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    STACK_SUPER_SECRET_ADMIN_KEY: z.string().min(1),
    STACK_DATA_VAULT_SECRET: z.string().min(32), // For secure DataBook storage
    // GitHub App
    CMUX_GITHUB_APP_ID: z.string().min(1),
    CMUX_GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    // Morph
    MORPH_API_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1),
    CMUX_TASK_RUN_JWT_SECRET: z.string().min(1),
    // AWS Bedrock for Claude
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(1),
    AWS_REGION: z.string().min(1).default("us-west-1"),
    ANTHROPIC_MODEL: z.string().min(1).default("global.anthropic.claude-opus-4-5-20251101-v1:0"),
    ANTHROPIC_SMALL_FAST_MODEL: z.string().min(1).default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  },
  client: {
    NEXT_PUBLIC_STACK_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: z.string().min(1),
    NEXT_PUBLIC_CONVEX_URL: z.string().min(1),
    NEXT_PUBLIC_GITHUB_APP_SLUG: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
