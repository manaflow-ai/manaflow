import { normalizeOrigin } from "@cmux/shared";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Public origin used across the app; prefer this for WWW base URL
    NEXT_PUBLIC_WWW_ORIGIN: z.string().min(1).optional(),
    NEXT_PUBLIC_CONVEX_URL: z.string().min(1),
    // When enabled, restricts features to web-compatible only (e.g., cloud mode only, no local Docker)
    NEXT_PUBLIC_WEB_MODE: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  },
  // Handle both Node and Vite/Bun
  runtimeEnv: { ...import.meta.env, ...process.env },
  emptyStringAsUndefined: true,
});

export function getWwwBaseUrl(): string {
  // Read from live process.env first to support tests that mutate env at runtime
  const rawOrigin =
    // Prefer the public origin for the WWW app when available
    process.env.NEXT_PUBLIC_WWW_ORIGIN ||
    env.NEXT_PUBLIC_WWW_ORIGIN ||
    "http://localhost:9779";
  return normalizeOrigin(rawOrigin);
}
