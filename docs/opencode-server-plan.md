# OpenCode Server + ACP Dual Path Plan

## Goals
- Support **two parallel execution codepaths** in the UI:
  - **ACP** (Claude/Codex/Gemini, etc.)
  - **OpenCode server** (single provider: `opencode-server`, exposed to UI as `opencode`)
- **Streaming** support for OpenCode server (SSE `/event`).
- **Sandbox proxy** access to OpenCode server (no direct public exposure of port 4096).
- **Remove `opencode-acp`** and keep a single `opencode-server` provider.
- Preserve existing ACP behavior and UI while enabling OpenCode server path.

## Non-goals
- No changes to README or public docs (unless explicitly requested later).
- No changes to the OpenCode repo; integration only in cmux.

## Current State (Summary)
- `/t/` routes use ACP-only data (Convex `conversations`, `conversationMessages`, `acpRawEvents`).
- Live streaming uses ACP SSE via `useAcpSandboxStream`.
- OpenCode already runs in sandboxes via `opencode-ai` CLI on port 4096, and TUI endpoints are used by post-start scripts.
- OpenCode server exposes:
  - `POST /session` (create)
  - `POST /session/:sessionID/message` (send)
  - `GET /session/:sessionID/message` (list)
  - `GET /event` (SSE events)

## High-Level Architecture
### A) ACP Path (unchanged)
- Keep existing ACP flow for non-opencode providers.
- ACP continues to write messages and raw events to Convex.

### B) OpenCode Server Path (new)
- Provider ID: **`opencode-server`** (UI label: “OpenCode”).
- Data source: OpenCode server API proxied through sandbox API.
- Streaming: `GET /event` SSE from OpenCode server, filtered by `sessionID`.

### C) Both (shared UI)
- UI should branch on provider type:
  - ACP providers → current ACP pipeline
  - OpenCode server provider → new OpenCode pipeline

## Access via Sandbox Proxy
- Use sandbox proxy to reach `http://127.0.0.1:4096` inside sandbox.
- Use existing sandbox API proxy (`/sandboxes/{id}/proxy?port=4096`).
- The UI should compute an **OpenCode base URL** that targets the sandbox proxy.
- For SSE, the same proxy endpoint must support streaming response (no buffering).

## Data Model Updates
- `conversations.providerId` values:
  - Replace any references to `opencode`/`opencode-acp` with **`opencode-server`**.
- `conversations.sessionId` remains used for OpenCode session ID.
- Add a **new table** for OpenCode raw events (or reuse `acpRawEvents` with a `source` tag) if we need persistence:
  - `opencodeRawEvents`: `{ conversationId, seq, raw, createdAt }`
- Optional: add `opencodeSessionId` if we want to distinguish from ACP `sessionId`. (Prefer reusing `sessionId` to avoid churn.)

## API/Convex Changes
### New Convex actions/queries
- `opencode.startConversation`:
  - Creates/claims sandbox (existing ACP infra)
  - Calls OpenCode `POST /session` via sandbox proxy
  - Stores returned `sessionId` on conversation
- `opencode.sendMessage`:
  - Calls OpenCode `POST /session/:sessionID/message`
  - Returns server response for optimistic update
- `opencode.getStreamInfo`:
  - Returns proxy URL + auth (if needed)
  - For OpenCode server, no JWT required by default unless password is set
- `opencode.listMessages`:
  - Calls OpenCode `GET /session/:sessionID/message`

### Provider Migration
- Remove any `opencode-acp` selection from provider lists.
- Map UI “OpenCode” → `opencode-server`.
- Update any default models / config files that reference opencode-acp.

## UI Changes
### Conversations list (`/t` layout)
- For OpenCode provider:
  - Use new `opencode.startConversation` and `opencode.sendMessage` instead of ACP.
  - Keep optimistic UX, but ensure the persisted conversation ID is resolved correctly.

### Thread view (`/t/:conversationId`)
- Branch on provider:
  - ACP: existing path
  - OpenCode:
    - Use `opencode.listMessages` for base state
    - Use new `useOpencodeStream` for live updates
    - Build streaming UI from `message.part.updated` events

### Streaming behavior
- OpenCode SSE `/event` → parse `data:` lines (JSON)
- Filter by `sessionID` matching the conversation
- For `message.part.updated`:
  - If `part.type === "text"`, append `delta || part.text`
  - If `part.type === "tool"`, update tool panels
  - If `part.time.end` or `message.updated` indicates completion, finalize stream

## Provider Config Cleanup
- Replace `opencode` provider label with `opencode-server` in configs
- Remove any “opencode-acp” references in UI/provider selection

## Streaming + Persistence Strategy (Both)
- **In-memory streaming:** OpenCode SSE drives live UI; no persistence required for streaming only.
- **Optional persistence:** Store OpenCode SSE events in Convex for history / debugging.

## Phased Work Plan
### Phase 1: Provider Migration
- Update provider lists and defaults to only `opencode-server` (label “OpenCode”).
- Ensure any config or selection code maps UI label to providerId.

### Phase 2: OpenCode Server API Path
- Add Convex actions for OpenCode server (start/send/list).
- Use sandbox proxy for all OpenCode server HTTP calls.

### Phase 3: Streaming
- Add `useOpencodeStream` hook (parallel to `useAcpSandboxStream`).
- Integrate into thread view with provider-based branching.

### Phase 4: Optional Persistence
- Add `opencodeRawEvents` storage if we want replay + debugging.
- Reconcile stream messages into Convex conversationMessages (if desired).

### Phase 5: Cleanup
- Remove ACP-specific logic for opencode provider.
- Remove unused configs, environment assumptions, and tests.

## Testing Checklist
- Start OpenCode conversation → messages flow to OpenCode server and UI updates.
- OpenCode streaming shows incremental text + tool outputs.
- ACP path unchanged (Claude/Codex/Gemini still work).
- Sandbox proxy handles SSE without buffering/timeouts.
- Provider migration doesn’t break existing saved conversations.

## Open Questions
- Do we persist OpenCode messages into Convex, or keep them server-backed only?
- Should OpenCode conversations be allowed to share a sandbox or be one-per-conversation?
- Do we require OpenCode server auth and how will credentials be passed through proxy?
