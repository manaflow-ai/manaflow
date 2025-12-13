import { normalizeOrigin } from "@cmux/shared";
import { env } from "@/client-env";

export const WWW_ORIGIN = normalizeOrigin(
  // TODO: handle main to never use this
  // process.env.NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW ||
  env.NEXT_PUBLIC_WWW_ORIGIN
);
