// =============================================================================
// TEMPORARY DEPRECATION FLAG
//
// Set to `false` to restore normal operation. When `true`:
//   - Next.js middleware redirects all non-manaflow.com traffic to manaflow.com
//   - All /api/* endpoints return 503
//   - Edge router (Cloudflare Worker) redirects *.cmux.sh to manaflow.com
//   - Convex HTTP routes return 503
//
// To fully remove: delete this file, revert middleware.ts to proxy.ts logic,
// revert edge-router/src/index.ts, and revert convex/http.ts guards.
// Search for "MANAFLOW_DEPRECATED" across the repo to find all references.
// =============================================================================

export const MANAFLOW_DEPRECATED = true;
