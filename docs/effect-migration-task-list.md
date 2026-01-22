# Effect Migration Task List (Convex Actions + HTTP)

## Scope
- Base: `main` → `swift-ios-clean`
- Include: newly introduced Convex `action` / `internalAction` / `httpAction`
- Output: plan + tasks only (no implementation yet)
- Constraint: tests must not spawn Morph instances

---

## 1) Inventory + Baseline
- [x] Confirm new endpoints/actions in this branch
  - HTTP endpoints: `acpCallback`, `anthropicProxy`, `anthropicCountTokens`, `anthropicEventLogging`, `openaiProxy`, `codexOAuthRefresh`
  - Actions/internal actions: ACP actions/internal actions, `generateTitle`, `dispatchTestJob`, `retryTestJob`
- [x] Identify all external side effects per endpoint (HTTP fetch, storage, scheduler, sandbox provider, JWT)
- [x] Decide Effect service boundaries (Env, Logger, HttpClient, Jwt, Clock, Scheduler, ConvexStore, SandboxProvider)

## 2) Effect Scaffolding
- [x] Add `effect` dependency to `packages/convex/package.json`
- [x] Create Effect bridge module (Convex → Effect runtime)
  - [x] `runEffect(ctx, program)` helper
  - [x] Service interfaces + default live layers
  - [x] Error types + response mapping helpers

## 3) HTTP Endpoint Migration (Effect Core + Convex Wrapper)
- [x] `packages/convex/convex/acp_http.ts`
  - [x] Extract request parsing + validation into Effect
  - [x] Extract dispatch logic into Effect
  - [x] Wrap with `httpAction` that runs Effect + maps errors
- [x] `packages/convex/convex/anthropic_http.ts`
  - [x] Extract request handling and upstream routing into Effect
  - [x] Extract stream/non-stream handling into Effect
  - [x] Wrap with `httpAction`
- [x] `packages/convex/convex/openai_http.ts`
  - [x] Extract request handling/path rewrite into Effect
  - [x] Extract stream/non-stream handling into Effect
  - [x] Wrap with `httpAction`
- [x] `packages/convex/convex/codex_oauth_http.ts`
  - [x] Extract form parsing + validation into Effect
  - [x] Extract OpenAI refresh flow into Effect
  - [x] Wrap with `httpAction`

## 4) Action/InternalAction Migration
- [x] `packages/convex/convex/acp.ts`
  - [x] Define SandboxProvider service + live layer
  - [x] Extract ACP action logic into Effect
  - [x] Keep Convex handler as thin wrapper
- [x] `packages/convex/convex/conversationSummary.ts` (`generateTitle`)
  - [x] Extract OpenAI call + title formatting into Effect
- [x] `packages/convex/convex/previewTestJobs.ts`
  - [x] Extract dispatch/retry flow into Effect
  - [x] Use Scheduler service in Effect

## 5) Test Harness (No Mocks, No Morph)
- [x] Build Effect test layers (in-memory)
  - [x] `TestSandboxProvider` (no real Morph)
  - [x] `TestHttpClient` (programmable responses + stream)
  - [x] `TestScheduler` (capture scheduled jobs)
  - [x] `TestConvexStore` (in-memory collections)
  - [x] `TestOpenAI` (fixed responses)
- [x] Ensure tests do not hit network or spawn sandboxes

## 6) Tests Per Endpoint/Action
- [x] `acp_http.test.ts`
  - [x] auth failures, content-type enforcement
  - [x] payload validation per type
  - [x] mutation dispatch mapping
- [x] `anthropic_http.test.ts`
  - [x] user key vs placeholder key path
  - [x] missing Bedrock token → 503
  - [x] stream handling
  - [x] upstream error passthrough
- [x] `openai_http.test.ts`
  - [x] missing API key → 500
  - [x] path rewrite
  - [x] stream handling
- [x] `codex_oauth_http.test.ts`
  - [x] content-type enforcement
  - [x] invalid grant/missing token
  - [x] invalid proxy token
  - [x] success path updates + response mapping
- [x] `acp.test.ts`
  - [x] warm sandbox reserve vs spawn
  - [x] startConversation reuse by clientConversationId
  - [x] sendMessage retry + scheduling
  - [x] sendRpc delivery
- [x] `conversationSummary.test.ts`
  - [x] no key → skip
  - [x] truncation + style selection
- [x] `previewTestJobs.test.ts`
  - [x] auth + membership guard
  - [x] dispatch scheduling
  - [x] retry creates new run and dispatches

## 7) Rollout Order
- [x] HTTP proxies first
- [x] `generateTitle`
- [x] preview test jobs
- [x] ACP actions (highest risk)

## 8) Validation
- [x] `bun check`
- [x] `cd packages/convex && bun run test`
