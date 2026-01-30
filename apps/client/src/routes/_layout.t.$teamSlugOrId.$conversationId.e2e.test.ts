import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const OPTIMISTIC_CONVERSATION_PREFIX = "client-";
const RAW_BASE_URL =
  process.env.CMUX_E2E_BASE_URL ??
  "http://localhost:5173/t/manaflow/ts7fqvmq7e4b6xacrs04sp1heh7zfw0h";
const SESSION = process.env.CMUX_E2E_SESSION ?? "cmux";

const DEFAULT_TIMEOUT_MS = 20_000;
const E2E_TAB_KIND = "e2e";

function buildE2EUrl(resetToken: string): string {
  const base = RAW_BASE_URL.startsWith("http")
    ? new URL(RAW_BASE_URL)
    : new URL(RAW_BASE_URL, "http://localhost");
  base.searchParams.set("e2e", "1");
  base.searchParams.set("e2e-reset", resetToken);
  return base.toString();
}

function createResetToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function withSearchParams(baseUrl: string, search: string): string {
  const url = baseUrl.startsWith("http")
    ? new URL(baseUrl)
    : new URL(baseUrl, "http://localhost");
  url.search = search;
  return url.toString();
}

const MutationLogRefSchema = z.object({
  conversationId: z.string(),
  clientConversationId: z.string().nullable(),
});

const MutationLogItemSchema = MutationLogRefSchema.extend({
  title: z.string(),
  preview: z.string(),
});

const MutationLogEntrySchema = z.object({
  at: z.number(),
  reason: z.enum(["init", "mutation"]),
  items: z.array(MutationLogItemSchema),
  added: z.array(MutationLogRefSchema),
  removed: z.array(MutationLogRefSchema),
});

const MutationLogSchema = z.array(MutationLogEntrySchema);

type MutationLogEntry = z.infer<typeof MutationLogEntrySchema>;
type MutationLogRef = z.infer<typeof MutationLogRefSchema>;

const MessageMutationRefSchema = z.object({
  messageId: z.string(),
  messageKey: z.string().nullable(),
  renderId: z.string().nullable(),
});

const MessageMutationItemSchema = MessageMutationRefSchema.extend({
  role: z.string().nullable(),
  text: z.string(),
});


const MessageMutationEntrySchema = z.object({
  at: z.number(),
  reason: z.enum(["init", "mutation"]),
  items: z.array(MessageMutationItemSchema),
  added: z.array(MessageMutationRefSchema),
  removed: z.array(MessageMutationRefSchema),
});

const MessageMutationLogSchema = z.array(MessageMutationEntrySchema);

type MessageMutationEntry = z.infer<typeof MessageMutationEntrySchema>;
type MessageMutationRef = z.infer<typeof MessageMutationRefSchema>;

const WorkspaceTabSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
});

const WorkspacePanelNodeSchema = z.object({
  type: z.literal("panel"),
  id: z.string(),
  tabs: z.array(WorkspaceTabSchema),
  activeTabId: z.string().nullable(),
});

type WorkspacePanelNode = z.infer<typeof WorkspacePanelNodeSchema>;
type WorkspaceSplitNode = {
  type: "split";
  id: string;
  direction: "row" | "column";
  children: WorkspaceNode[];
  sizes: number[];
};
type WorkspaceNode = WorkspacePanelNode | WorkspaceSplitNode;

const WorkspaceNodeSchema: z.ZodType<WorkspaceNode> = z.lazy(() =>
  z.union([WorkspacePanelNodeSchema, WorkspaceSplitNodeSchema])
);

const WorkspaceSplitNodeSchema: z.ZodType<WorkspaceSplitNode> = z.object({
  type: z.literal("split"),
  id: z.string(),
  direction: z.enum(["row", "column"]),
  children: z.array(WorkspaceNodeSchema),
  sizes: z.array(z.number()),
});

async function runAgent(
  args: string[],
  session: string,
  timeout = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const { stdout } = await execFileAsync(
    "agent-browser",
    ["--session", session, ...args],
    { timeout }
  );
  return stdout.trim();
}

function parseJsonOutput<T>(output: string): T {
  const trimmed = output.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`Expected JSON output, got: ${output}`);
  }
  return JSON.parse(trimmed.slice(firstBrace)) as T;
}

function parseEvalJson<T>(output: string): T {
  const trimmed = output.trim();
  const candidates: string[] = [trimmed];
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      const unquoted = JSON.parse(trimmed);
      if (typeof unquoted === "string") {
        candidates.push(unquoted);
      }
    } catch (error) {
      console.error("Failed to parse eval output string", error);
    }
  }
  for (const candidate of candidates) {
    const braceIndex = candidate.indexOf("{");
    const bracketIndex = candidate.indexOf("[");
    const indices = [braceIndex, bracketIndex].filter((idx) => idx >= 0);
    if (indices.length === 0) continue;
    const start = Math.min(...indices);
    try {
      return JSON.parse(candidate.slice(start)) as T;
    } catch (error) {
      console.error("Failed to parse eval JSON candidate", error);
      continue;
    }
  }
  throw new Error(`Unable to parse eval output: ${output}`);
}

async function snapshotInteractive(session: string) {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const output = await runAgent(["snapshot", "-i", "--json"], session);
    const parsed = parseJsonOutput<{
      success: boolean;
      data?: {
        refs: Record<string, { name?: string; role?: string }>;
        snapshot: string;
      };
    }>(output);
    if (parsed.success && parsed.data?.refs) {
      const refs = parsed.data.refs;
      if (Object.keys(refs).length > 0) {
        return refs;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Snapshot failed: no interactive elements found");
}

async function evalJson<T>(session: string, script: string): Promise<T> {
  const output = await runAgent(["eval", script], session);
  return parseEvalJson<T>(output);
}

async function snapshotCompact(session: string) {
  return await runAgent(["snapshot", "-c"], session);
}

function tryExtractConversationIdFromUrl(urlString: string): string | null {
  const url = urlString.startsWith("http")
    ? new URL(urlString)
    : new URL(urlString, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[2] ?? null;
}

function extractConversationIdFromUrl(urlString: string): string {
  const conversationId = tryExtractConversationIdFromUrl(urlString);
  if (!conversationId) {
    throw new Error(`Failed to parse conversation id from url: ${urlString}`);
  }
  return conversationId;
}

function extractTeamSlugOrIdFromUrl(urlString: string): string | null {
  const url = urlString.startsWith("http")
    ? new URL(urlString)
    : new URL(urlString, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[1] ?? null;
}

function extractClientConversationId(conversationId: string): string {
  if (!conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX)) {
    throw new Error(
      `Conversation id is not optimistic: ${conversationId}`
    );
  }
  return conversationId.slice(OPTIMISTIC_CONVERSATION_PREFIX.length);
}

function pickRef(
  refs: Record<string, { name?: string; role?: string }>,
  predicate: (value: { name?: string; role?: string }) => boolean
): string {
  for (const [ref, value] of Object.entries(refs)) {
    if (predicate(value)) return ref;
  }
  throw new Error("Failed to find matching ref");
}

async function waitForRef(
  session: string,
  predicate: (value: { name?: string; role?: string }) => boolean
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const refs = await snapshotInteractive(session);
    const entry = Object.entries(refs).find(([, value]) =>
      predicate(value)
    );
    if (entry) {
      return entry[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for ref");
}

async function tryClickRef(session: string, ref: string): Promise<boolean> {
  try {
    await runAgent(["click", `@${ref}`], session);
    return true;
  } catch (error) {
    console.error("Failed to click ref", error);
    return false;
  }
}

async function ensureComposerVisible(session: string) {
  const refs = await snapshotInteractive(session);
  const hasComposer = Object.values(refs).some(
    (entry) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("start a new conversation") ?? false)
  );
  if (hasComposer) return;

  const passwordTabRef = Object.entries(refs).find(
    ([, entry]) =>
      entry.role === "tab" &&
      (entry.name?.toLowerCase().includes("email & password") ?? false)
  )?.[0];
  if (passwordTabRef) {
    await runAgent(["click", `@${passwordTabRef}`], session);
    await runAgent(["wait", "500"], session);
  }

  const refreshedRefs = await snapshotInteractive(session);
  const emailRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("email") ?? false)
  )?.[0];
  const passwordRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("password") ?? false)
  )?.[0];
  const signInRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "button" &&
      (entry.name?.toLowerCase().includes("sign in") ?? false)
  )?.[0];

  if (emailRef) {
    await runAgent(
      ["fill", `@${emailRef}`, process.env.CMUX_E2E_EMAIL ?? "l@l.com"],
      session
    );
  }
  if (passwordRef) {
    await runAgent(
      ["fill", `@${passwordRef}`, process.env.CMUX_E2E_PASSWORD ?? "abc123"],
      session
    );
  }
  if (signInRef) {
    await runAgent(["click", `@${signInRef}`], session);
  }

  await runAgent(["wait", "1500"], session);
  await waitForRef(session, (entry) =>
    entry.role === "textbox" &&
    (entry.name?.toLowerCase().includes("start a new conversation") ?? false)
  );
}

async function getComposerInputRef(session: string): Promise<string> {
  const refs = await snapshotInteractive(session);
  return pickRef(refs, (entry) =>
    entry.role === "textbox" &&
    (entry.name?.toLowerCase().includes("start a new conversation") ?? false)
  );
}

async function getCreateConversationRef(session: string): Promise<string> {
  const refs = await snapshotInteractive(session);
  return pickRef(refs, (entry) =>
    entry.role === "button" &&
    (entry.name?.toLowerCase().includes("create conversation") ?? false)
  );
}

async function readMutationLog(session: string): Promise<MutationLogEntry[]> {
  const refs = await snapshotInteractive(session);
  const logRef = pickRef(refs, (entry) => {
    if (entry.role !== "textbox") return false;
    return entry.name?.toLowerCase().includes("conversation mutation log") ?? false;
  });
  const raw = await runAgent(["get", "value", `@${logRef}`], session);
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return MutationLogSchema.parse(JSON.parse(trimmed));
}

async function waitForMutationLog(
  session: string,
  predicate: (log: MutationLogEntry[]) => boolean,
  timeoutMs = 12_000
): Promise<MutationLogEntry[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = await readMutationLog(session);
    if (predicate(log)) return log;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for mutation log condition");
}

async function readMessageMutationLog(
  session: string
): Promise<MessageMutationEntry[]> {
  const refs = await snapshotInteractive(session);
  const logRef = pickRef(refs, (entry) => {
    if (entry.role !== "textbox") return false;
    return entry.name?.toLowerCase().includes("message mutation log") ?? false;
  });
  const raw = await runAgent(["get", "value", `@${logRef}`], session);
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return MessageMutationLogSchema.parse(JSON.parse(trimmed));
}

async function waitForMessageMutationLog(
  session: string,
  predicate: (log: MessageMutationEntry[]) => boolean,
  timeoutMs = 12_000
): Promise<MessageMutationEntry[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = await readMessageMutationLog(session);
    if (predicate(log)) return log;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for message mutation log condition");
}

function messageKeyFor(item: MessageMutationRef): string {
  return item.messageKey ?? item.messageId;
}

async function waitForUrl(
  session: string,
  predicate: (url: string) => boolean,
  timeoutMs = 16_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await runAgent(["get", "url"], session);
    if (predicate(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for url condition");
}

type WorkspaceTabInfo = {
  id: string;
  title: string;
  kind: string;
  panelId: string | null;
};

type WorkspaceState = {
  tabs: WorkspaceTabInfo[];
  panelIds: string[];
  hasNewTerminalButton: boolean;
};

function getEmptyPanelIds(state: WorkspaceState): string[] {
  const occupied = new Set(
    state.tabs
      .map((tab) => tab.panelId)
      .filter((panelId): panelId is string => panelId !== null)
  );
  return state.panelIds.filter((panelId) => !occupied.has(panelId));
}

type Point = {
  x: number;
  y: number;
};

type Rect = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

async function readWorkspaceState(session: string): Promise<WorkspaceState> {
  return await evalJson<WorkspaceState>(
    session,
    `(() => {
      const tabs = Array.from(document.querySelectorAll('[data-workspace-tab-id]')).map((tab) => {
        const element = tab;
        const panel = element.closest('[data-workspace-panel-id]');
        return {
          id: element.getAttribute('data-workspace-tab-id') ?? '',
          title: element.getAttribute('data-workspace-tab-title') ?? '',
          kind: element.getAttribute('data-workspace-tab-kind') ?? '',
          panelId: panel ? panel.getAttribute('data-workspace-panel-id') : null,
        };
      });
      const panelIds = Array.from(new Set(
        Array.from(document.querySelectorAll('[data-workspace-panel-id]')).map(
          (panel) => panel.getAttribute('data-workspace-panel-id') ?? ''
        )
      )).filter(Boolean);
      const hasNewTerminalButton = Boolean(
        document.querySelector('[data-workspace-action="new-terminal"]')
      );
      return { tabs, panelIds, hasNewTerminalButton };
    })()`
  );
}

async function readWorkspaceStateFromE2E(
  session: string
): Promise<WorkspaceState | null> {
  const result = await evalJson<{ ok: boolean; state?: WorkspaceState }>(
    session,
    `(() => {
      const controls = window.__cmuxWorkspaceE2E;
      if (!controls || typeof controls.getState !== "function") {
        return { ok: false };
      }
      const root = controls.getState();
      const tabs = [];
      const panelIds = [];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "panel") {
          if (typeof node.id === "string") {
            panelIds.push(node.id);
          }
          if (Array.isArray(node.tabs)) {
            for (const tab of node.tabs) {
              tabs.push({
                id: String(tab.id ?? ""),
                title: String(tab.title ?? ""),
                kind: String(tab.kind ?? ""),
                panelId: typeof node.id === "string" ? node.id : null,
              });
            }
          }
          return;
        }
        if (node.type === "split" && Array.isArray(node.children)) {
          for (const child of node.children) {
            walk(child);
          }
        }
      };
      walk(root);
      const hasNewTerminalButton = Boolean(
        document.querySelector('[data-workspace-action="new-terminal"]')
      );
      return {
        ok: true,
        state: { tabs, panelIds: Array.from(new Set(panelIds)), hasNewTerminalButton },
      };
    })()`
  );
  return result.ok && result.state ? result.state : null;
}

async function waitForWorkspace(session: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const result = await evalJson<{ exists: boolean }>(
      session,
      `(() => ({ exists: Boolean(document.querySelector('[data-workspace-root]')) }))()`
    );
    if (result.exists) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for workspace");
}

async function waitForWorkspaceState(
  session: string,
  predicate: (state: WorkspaceState) => boolean,
  timeoutMs = 12_000
): Promise<WorkspaceState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readWorkspaceState(session);
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for workspace state");
}

async function clickNewTerminal(session: string) {
  const result = await evalJson<{ clicked: boolean }>(
    session,
    `(() => {
      const button = document.querySelector('[data-workspace-action="new-terminal"]');
      if (!button) return { clicked: false };
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { clicked: true };
    })()`
  );
  if (!result.clicked) {
    throw new Error("Failed to click new terminal button");
  }
}

async function addE2EWorkspaceTab(
  session: string,
  title?: string
): Promise<string | null> {
  const titleArg = title ? JSON.stringify(title) : "undefined";
  const result = await evalJson<{ id: string | null }>(
    session,
    `(() => {
      const controls = window.__cmuxWorkspaceE2E;
      if (!controls || typeof controls.addTab !== "function") {
        return { id: null };
      }
      const id = controls.addTab(${titleArg});
      return { id };
    })()`
  );
  return result.id ?? null;
}

async function splitWorkspaceTabE2E(
  session: string,
  tabId: string,
  edge: "left" | "right" | "top" | "bottom"
): Promise<boolean> {
  const result = await evalJson<{ ok: boolean }>(
    session,
    `(() => {
      const controls = window.__cmuxWorkspaceE2E;
      if (!controls || typeof controls.splitTab !== "function") {
        return { ok: false };
      }
      const ok = controls.splitTab(${JSON.stringify(tabId)}, "${edge}");
      return { ok };
    })()`
  );
  return result.ok;
}

type WorkspaceTabSet = {
  kind: string;
  tabs: WorkspaceTabInfo[];
};

async function ensureWorkspaceTabs(
  session: string,
  minCount: number
): Promise<WorkspaceTabSet> {
  const readTabsByKind = (state: WorkspaceState, kind: string) =>
    state.tabs.filter((tab) => tab.kind === kind);

  let state = await readWorkspaceState(session);
  let terminalTabs = readTabsByKind(state, "terminal");
  if (terminalTabs.length >= minCount) {
    return { kind: "terminal", tabs: terminalTabs };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await clickNewTerminal(session);
    await runAgent(["wait", "800"], session);
    state = await readWorkspaceState(session);
    terminalTabs = readTabsByKind(state, "terminal");
    if (terminalTabs.length >= minCount) {
      return { kind: "terminal", tabs: terminalTabs };
    }
  }

  let e2eAvailable = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await evalJson<{ available: boolean }>(
      session,
      `(() => ({
        available: typeof window.__cmuxWorkspaceE2E?.addTab === "function",
      }))()`
    );
    if (result.available) {
      e2eAvailable = true;
      break;
    }
    await runAgent(["wait", "300"], session);
  }
  if (!e2eAvailable) {
    throw new Error(
      "Terminal tabs were unavailable and no e2e workspace controls exist"
    );
  }

  let e2eTabs: WorkspaceTabInfo[] = [];
  for (let attempt = 0; attempt < minCount; attempt += 1) {
    await addE2EWorkspaceTab(session);
    await runAgent(["wait", "300"], session);
    state = await readWorkspaceState(session);
    e2eTabs = readTabsByKind(state, E2E_TAB_KIND);
    if (e2eTabs.length >= minCount) {
      return { kind: E2E_TAB_KIND, tabs: e2eTabs };
    }
  }

  throw new Error(
    `Expected at least ${minCount} workspace tabs, got ${e2eTabs.length}`
  );
}

async function dragWorkspaceTabToTab(
  session: string,
  tabId: string,
  targetTabId: string
) {
  const start = await getElementCenterBySelector(
    session,
    `[data-workspace-tab-id="${tabId}"]`
  );
  const end = await getElementCenterBySelector(
    session,
    `[data-workspace-tab-id="${targetTabId}"]`
  );
  await mouseDrag(session, start, end);
}

async function dragWorkspaceTabToPanelEdge(
  session: string,
  tabId: string,
  panelId: string,
  edge: "left" | "right" | "top" | "bottom"
) {
  const start = await getElementCenterBySelector(
    session,
    `[data-workspace-tab-id="${tabId}"]`
  );
  const end = await getPanelEdgePoint(session, panelId, edge);
  await mouseDrag(session, start, end);
}

async function dragWorkspaceTabToPanelEdgeSynthetic(
  session: string,
  tabId: string,
  panelId: string,
  edge: "left" | "right" | "top" | "bottom"
) {
  const startResult = await evalJson<{ ok: boolean; error?: string }>(
    session,
    `(() => {
      const tab = document.querySelector('[data-workspace-tab-id="${tabId}"]');
      if (!tab) return { ok: false, error: 'Missing tab' };
      const data = new DataTransfer();
      window.__cmuxWorkspaceDragData = data;
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
      return { ok: true };
    })()`
  );
  if (!startResult.ok) {
    throw new Error(startResult.error ?? "Failed to start synthetic drag");
  }
  await runAgent(["wait", "80"], session);
  const dropResult = await evalJson<{ ok: boolean; error?: string }>(
    session,
    `(() => {
      const edge = "${edge}";
      const tab = document.querySelector('[data-workspace-tab-id="${tabId}"]');
      const panel = document.querySelector('[data-workspace-panel-id="${panelId}"]');
      const data = window.__cmuxWorkspaceDragData;
      if (!tab || !panel || !data) return { ok: false, error: 'Missing tab, panel, or dataTransfer' };
      const edgeZone = panel.querySelector('[data-workspace-drop-edge="${edge}"]');
      const rect = panel.getBoundingClientRect();
      const inset = 10;
      const x = edge === 'left'
        ? rect.left + inset
        : edge === 'right'
          ? rect.right - inset
          : rect.left + rect.width / 2;
      const y = edge === 'top'
        ? rect.top + inset
        : edge === 'bottom'
          ? rect.bottom - inset
          : rect.top + rect.height * 0.7;
      const target = edgeZone ?? panel;
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: data, clientX: x, clientY: y }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data, clientX: x, clientY: y }));
      tab.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
      delete window.__cmuxWorkspaceDragData;
      return { ok: true };
    })()`
  );
  if (!dropResult.ok) {
    throw new Error(dropResult.error ?? "Failed to drag tab to panel edge");
  }
}

async function dragWorkspaceTabToPanelCenter(
  session: string,
  tabId: string,
  panelId: string
) {
  const start = await getElementCenterBySelector(
    session,
    `[data-workspace-tab-id="${tabId}"]`
  );
  const end = await getPanelCenter(session, panelId);
  await mouseDrag(session, start, end);
}

async function getElementCenterBySelector(
  session: string,
  selector: string
): Promise<Point> {
  const result = await evalJson<{ ok: boolean; x: number; y: number }>(
    session,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false, x: 0, y: 0 };
      const rect = element.getBoundingClientRect();
      return {
        ok: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`
  );
  if (!result.ok) {
    throw new Error(`Missing element for selector: ${selector}`);
  }
  return { x: Math.round(result.x), y: Math.round(result.y) };
}

async function getElementRect(
  session: string,
  selector: string
): Promise<Rect> {
  const result = await evalJson<{ ok: boolean; rect?: Rect }>(
    session,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false };
      const rect = element.getBoundingClientRect();
      return {
        ok: true,
        rect: {
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      };
    })()`
  );
  if (!result.ok || !result.rect) {
    throw new Error(`Missing element for rect: ${selector}`);
  }
  return result.rect;
}

async function getPanelRects(session: string): Promise<Rect[]> {
  const result = await evalJson<{ rects: Rect[] }>(
    session,
    `(() => {
      const rects = Array.from(document.querySelectorAll('[data-workspace-panel-id]'))
        .map((panel) => {
          const rect = panel.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        });
      return { rects };
    })()`
  );
  return result.rects;
}

async function assertPanelRectsSane(session: string) {
  const workspaceRect = await getElementRect(
    session,
    "[data-workspace-container]"
  );
  const rects = await getPanelRects(session);
  if (rects.length === 0) {
    throw new Error("Expected at least one panel rect");
  }
  const minSize = 120;
  for (const rect of rects) {
    expect(rect.width).toBeGreaterThanOrEqual(minSize);
    expect(rect.height).toBeGreaterThanOrEqual(minSize);
    expect(rect.left).toBeGreaterThanOrEqual(workspaceRect.left - 1);
    expect(rect.right).toBeLessThanOrEqual(workspaceRect.right + 1);
    expect(rect.top).toBeGreaterThanOrEqual(workspaceRect.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(workspaceRect.bottom + 1);
  }
}

async function waitForWidthChange(
  session: string,
  selector: string,
  initialWidth: number,
  minDelta = 40
): Promise<Rect> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rect = await getElementRect(session, selector);
    if (Math.abs(rect.width - initialWidth) >= minDelta) {
      return rect;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for width change: ${selector}`);
}

async function dragHandleBy(
  session: string,
  selector: string,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const start = await getElementCenterBySelector(session, selector);
  const end = {
    x: Math.round(start.x + deltaX),
    y: Math.round(start.y + deltaY),
  };
  await mouseDrag(session, start, end);
}

async function dragSplitHandleSynthetic(
  session: string,
  selector: string,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const result = await evalJson<{ ok: boolean; error?: string }>(
    session,
    `(() => {
      const handle = document.querySelector(${JSON.stringify(selector)});
      if (!handle) return { ok: false, error: "Missing split handle" };
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const endX = startX + ${deltaX};
      const endY = startY + ${deltaY};
      handle.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        clientX: startX,
        clientY: startY,
        buttons: 1,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: endX,
        clientY: endY,
        buttons: 1,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        clientX: endX,
        clientY: endY,
      }));
      return { ok: true };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.error ?? "Failed to resize split handle");
  }
}

async function dragWorkspaceResizeHandleSynthetic(
  session: string,
  selector: string,
  deltaX: number
): Promise<void> {
  const result = await evalJson<{ ok: boolean; error?: string }>(
    session,
    `(() => {
      const handle = document.querySelector(${JSON.stringify(selector)});
      if (!handle) return { ok: false, error: "Missing workspace resize handle" };
      const rect = handle.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const endX = startX + ${deltaX};
      handle.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        clientX: startX,
        clientY: startY,
        buttons: 1,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        clientX: endX,
        clientY: startY,
        buttons: 1,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        clientX: endX,
        clientY: startY,
      }));
      return { ok: true };
    })()`
  );
  if (!result.ok) {
    throw new Error(result.error ?? "Failed to resize workspace handle");
  }
}

async function getSplitHandleDirection(
  session: string
): Promise<"row" | "column"> {
  const result = await evalJson<{ ok: boolean; direction?: "row" | "column" }>(
    session,
    `(() => {
      const handle = document.querySelector('[data-workspace-split-handle]');
      if (!handle) return { ok: false };
      const direction = handle.getAttribute('data-workspace-split-direction');
      if (direction !== 'row' && direction !== 'column') return { ok: false };
      return { ok: true, direction };
    })()`
  );
  if (!result.ok || !result.direction) {
    throw new Error("Missing split handle direction");
  }
  return result.direction;
}

async function readWorkspaceRootFromE2E(
  session: string
): Promise<WorkspaceNode | null> {
  const result = await evalJson<{ ok: boolean; root?: unknown }>(
    session,
    `(() => {
      const controls = window.__cmuxWorkspaceE2E;
      if (!controls || typeof controls.getState !== "function") {
        return { ok: false };
      }
      return { ok: true, root: controls.getState() };
    })()`
  );
  if (!result.ok || !result.root) return null;
  const parse = WorkspaceNodeSchema.safeParse(result.root);
  return parse.success ? parse.data : null;
}

function findFirstSplit(
  node: WorkspaceNode
): { direction: "row" | "column"; sizes: number[] } | null {
  if (node.type === "split") {
    return { direction: node.direction, sizes: node.sizes };
  }
  return null;
}

async function waitForSplitSizesChange(
  session: string,
  initialSizes: number[],
  minDelta = 0.05
): Promise<number[]> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const root = await readWorkspaceRootFromE2E(session);
    if (root) {
      const split = findFirstSplit(root);
      if (split) {
        const delta = Math.abs(split.sizes[0] - initialSizes[0]);
        if (delta >= minDelta) {
          return split.sizes;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for split sizes to change");
}

async function getPanelCenter(
  session: string,
  panelId: string
): Promise<Point> {
  const result = await evalJson<{ ok: boolean; x: number; y: number }>(
    session,
    `(() => {
      const panel = document.querySelector('[data-workspace-panel-id="${panelId}"]');
      if (!panel) return { ok: false, x: 0, y: 0 };
      const rect = panel.getBoundingClientRect();
      return {
        ok: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })()`
  );
  if (!result.ok) {
    throw new Error("Missing panel to compute center");
  }
  return { x: Math.round(result.x), y: Math.round(result.y) };
}

async function getPanelEdgePoint(
  session: string,
  panelId: string,
  edge: "left" | "right" | "top" | "bottom"
): Promise<Point> {
  const result = await evalJson<{ ok: boolean; x: number; y: number }>(
    session,
    `(() => {
      const edge = "${edge}";
      const panel = document.querySelector('[data-workspace-panel-id="${panelId}"]');
      if (!panel) return { ok: false, x: 0, y: 0 };
      const rect = panel.getBoundingClientRect();
      const tabButton = panel.querySelector('[data-workspace-tab-id]');
      const headerBottom = tabButton instanceof HTMLElement
        ? tabButton.getBoundingClientRect().bottom
        : rect.top;
      const inset = 10;
      const x = edge === 'left'
        ? rect.left + inset
        : edge === 'right'
          ? rect.right - inset
          : rect.left + rect.width / 2;
      const yStart = Math.min(rect.bottom - inset, headerBottom + 12);
      if (edge === 'top') {
        return { ok: true, x, y: rect.top + inset };
      }
      if (edge === 'bottom') {
        return { ok: true, x, y: rect.bottom - inset };
      }
      for (let y = yStart; y <= rect.bottom - inset; y += 18) {
        const hit = document.elementFromPoint(x, y);
        if (hit && panel.contains(hit)) {
          const isTab = Boolean(hit.closest('[data-workspace-tab-id], [data-workspace-tab-close]'));
          if (!isTab) {
            return { ok: true, x, y };
          }
        }
      }
      return { ok: true, x, y: Math.min(rect.bottom - inset, yStart) };
    })()`
  );
  if (!result.ok) {
    throw new Error("Missing panel to compute edge point");
  }
  return { x: Math.round(result.x), y: Math.round(result.y) };
}

async function mouseDrag(
  session: string,
  start: Point,
  end: Point
): Promise<void> {
  const mid: Point = {
    x: Math.round(start.x + (end.x - start.x) * 0.2),
    y: Math.round(start.y + (end.y - start.y) * 0.2),
  };
  await runAgent(["mouse", "move", String(start.x), String(start.y)], session);
  await runAgent(["mouse", "down", "left"], session);
  await runAgent(["wait", "120"], session);
  await runAgent(["mouse", "move", String(mid.x), String(mid.y)], session);
  await runAgent(["wait", "120"], session);
  await runAgent(["mouse", "move", String(end.x), String(end.y)], session);
  await runAgent(["wait", "160"], session);
  await runAgent(["mouse", "up", "left"], session);
  await runAgent(["wait", "200"], session);
}

async function ensureSplitPanel(
  session: string,
  tabId: string,
  panelId: string,
  edge: "left" | "right" | "top" | "bottom"
): Promise<WorkspaceState> {
  await dragWorkspaceTabToPanelEdge(session, tabId, panelId, edge);
  let splitState: WorkspaceState | null = null;
  try {
    splitState = await waitForWorkspaceState(
      session,
      (state) => state.panelIds.length >= 2,
      4_000
    );
  } catch (error) {
    console.error("Primary split drag did not create a split", error);
    let syntheticError: unknown = null;
    try {
      await dragWorkspaceTabToPanelEdgeSynthetic(session, tabId, panelId, edge);
      splitState = await waitForWorkspaceState(
        session,
        (state) => state.panelIds.length >= 2,
        4_000
      );
    } catch (error) {
      console.error("Synthetic split drag failed", error);
      syntheticError = error;
    }
    if (!splitState) {
      const didSplit = await splitWorkspaceTabE2E(session, tabId, edge);
      if (!didSplit) {
        if (syntheticError instanceof Error) {
          throw syntheticError;
        }
        throw new Error("Failed to split workspace via e2e controls");
      }
      const e2eState = await readWorkspaceStateFromE2E(session);
      if (e2eState && e2eState.panelIds.length >= 2) {
        splitState = e2eState;
      } else {
        splitState = await waitForWorkspaceState(
          session,
          (state) => state.panelIds.length >= 2
        );
      }
    }
  }
  return splitState;
}

function findClientMatches(
  entry: MutationLogEntry,
  clientConversationId: string
): MutationLogRef[] {
  return entry.items.filter(
    (item) => item.clientConversationId === clientConversationId
  );
}

function hasRealId(
  entry: MutationLogEntry,
  clientConversationId: string
): boolean {
  return entry.items.some(
    (item) =>
      item.clientConversationId === clientConversationId &&
      !item.conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX)
  );
}

function extractMainBlock(snapshot: string): string {
  const lines = snapshot.split("\n");
  const mainIndex = lines.findIndex((line) => line.trim() === "- main:");
  if (mainIndex === -1) return snapshot;
  const output: string[] = [];
  for (let i = mainIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {2}- /.test(line)) {
      break;
    }
    if (line.toLowerCase().includes("mutation log")) {
      continue;
    }
    output.push(line);
  }
  return output.join("\n");
}

async function hasMessageInDom(
  session: string,
  message: string
): Promise<boolean> {
  const result = await evalJson<{ has: boolean }>(
    session,
    `(() => {
      const root = document.querySelector('main') ?? document.body;
      const nodes = Array.from(
        root.querySelectorAll('[data-message-id], [data-message-key]')
      );
      const has = nodes.some((node) => {
        const text = node.textContent ?? "";
        return text.includes(${JSON.stringify(message)});
      });
      return { has };
    })()`
  );
  return result.has;
}

async function waitForMessage(session: string, message: string) {
  const deadline = Date.now() + 16_000;
  while (Date.now() < deadline) {
    const domHas = await hasMessageInDom(session, message);
    if (domHas) {
      return;
    }
    const snapshot = await snapshotCompact(session);
    const mainBlock = extractMainBlock(snapshot);
    if (mainBlock.includes(message)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for message: ${message}`);
}

async function assertMessageMissing(session: string, message: string) {
  const domHas = await hasMessageInDom(session, message);
  expect(domHas).toBe(false);
  const snapshot = await snapshotCompact(session);
  const mainBlock = extractMainBlock(snapshot);
  expect(mainBlock).not.toContain(message);
}

describe("optimistic conversations e2e", () => {
  it(
    "keeps optimistic message when leaving and returning",
    async () => {
      const message = `optimistic return ${Date.now()}`;
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const inputRef = await getComposerInputRef(SESSION);
      await runAgent(["fill", `@${inputRef}`, message], SESSION);
      const createRef = await getCreateConversationRef(SESSION);
      await runAgent(["click", `@${createRef}`], SESSION);

      await waitForMessage(SESSION, message);

      const createdConversationUrl = await runAgent(["get", "url"], SESSION);
      const snapshotAfterCreateRefs = await snapshotInteractive(SESSION);
      const otherConversationEntry = Object.entries(snapshotAfterCreateRefs).find(
        ([, entry]) => {
          if (entry.role !== "link") return false;
          if (!entry.name) return false;
          if (entry.name.toLowerCase().includes("conversation settings")) return false;
          if (entry.name.includes(message)) return false;
          return true;
        }
      );

      let clickedOther = false;
      if (otherConversationEntry) {
        clickedOther = await tryClickRef(SESSION, otherConversationEntry[0]);
      }
      if (!clickedOther) {
        const refreshedRefs = await snapshotInteractive(SESSION);
        const refreshedOtherEntry = Object.entries(refreshedRefs).find(
          ([, entry]) => {
            if (entry.role !== "link") return false;
            if (!entry.name) return false;
            if (entry.name.toLowerCase().includes("conversation settings")) return false;
            if (entry.name.includes(message)) return false;
            return true;
          }
        );
        if (refreshedOtherEntry) {
          clickedOther = await tryClickRef(SESSION, refreshedOtherEntry[0]);
        }
      }
      if (!clickedOther) {
        const fallbackUrl = withSearchParams(
          RAW_BASE_URL,
          new URL(createdConversationUrl).search
        );
        const fallbackConversationId =
          tryExtractConversationIdFromUrl(fallbackUrl);
        const createdConversationId =
          tryExtractConversationIdFromUrl(createdConversationUrl);
        if (
          fallbackConversationId &&
          createdConversationId &&
          fallbackConversationId === createdConversationId
        ) {
          const teamSlugOrId = extractTeamSlugOrIdFromUrl(createdConversationUrl);
          if (!teamSlugOrId) {
            throw new Error("Failed to parse team slug from url");
          }
          await runAgent(
            [
              "open",
              `${new URL(createdConversationUrl).origin}/t/${teamSlugOrId}${
                new URL(createdConversationUrl).search
              }`,
            ],
            SESSION
          );
        } else {
          await runAgent(["open", fallbackUrl], SESSION);
        }
      }
      await runAgent(["wait", "800"], SESSION);

      const backSnapshotRefs = await snapshotInteractive(SESSION);
      const returnEntry = Object.entries(backSnapshotRefs).find(([, entry]) =>
        entry.role === "link" && (entry.name?.includes(message) ?? false)
      );

      if (returnEntry) {
        await runAgent(["click", `@${returnEntry[0]}`], SESSION);
      } else {
        await runAgent(["open", createdConversationUrl], SESSION);
      }
      await waitForMessage(SESSION, message);
    },
    30_000
  );

  it(
    "keeps latest conversation focused on quick-succession create",
    async () => {
      const first = `succession one ${Date.now()}`;
      const second = `succession two ${Date.now()}`;
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const inputRef = await getComposerInputRef(SESSION);
      await runAgent(["fill", `@${inputRef}`, first], SESSION);
      const firstCreateRef = await getCreateConversationRef(SESSION);
      await runAgent(["click", `@${firstCreateRef}`], SESSION);

      const inputRefAgain = await getComposerInputRef(SESSION);
      await runAgent(["fill", `@${inputRefAgain}`, second], SESSION);
      const secondCreateRef = await getCreateConversationRef(SESSION);
      await runAgent(["click", `@${secondCreateRef}`], SESSION);

      await waitForMessage(SESSION, second);
      await assertMessageMissing(SESSION, first);
    },
    30_000
  );

  it(
    "keeps message elements without flashes or duplicates",
    async () => {
      const message = "1+1";
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);
      await waitForRef(SESSION, (entry) => {
        if (entry.role !== "textbox") return false;
        return entry.name?.toLowerCase().includes("conversation mutation log") ?? false;
      });
      await waitForRef(SESSION, (entry) => {
        if (entry.role !== "textbox") return false;
        return entry.name?.toLowerCase().includes("message mutation log") ?? false;
      });

      const inputRef = await getComposerInputRef(SESSION);
      await runAgent(["fill", `@${inputRef}`, message], SESSION);
      const createRef = await getCreateConversationRef(SESSION);
      await runAgent(["click", `@${createRef}`], SESSION);

      const optimisticUrl = await waitForUrl(SESSION, (url) => {
        const conversationId = tryExtractConversationIdFromUrl(url);
        if (!conversationId) return false;
        return conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX);
      });
      const optimisticConversationId =
        extractConversationIdFromUrl(optimisticUrl);
      const clientConversationId = extractClientConversationId(
        optimisticConversationId
      );

      await waitForMutationLog(
        SESSION,
        (log) =>
          log.some(
            (entry) =>
              findClientMatches(entry, clientConversationId).length > 0
          )
      );

      await waitForMessageMutationLog(
        SESSION,
        (log) =>
          log.some((entry) =>
            entry.items.some(
              (item) => item.role === "user" && item.text.includes(message)
            )
          )
      );

      await waitForUrl(
        SESSION,
        (url) => {
          const conversationId = tryExtractConversationIdFromUrl(url);
          if (!conversationId) return false;
          return !conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX);
        },
        18_000
      );

      await waitForMutationLog(
        SESSION,
        (log) => log.some((entry) => hasRealId(entry, clientConversationId)),
        18_000
      );

      await runAgent(["wait", "800"], SESSION);

      const log = await readMutationLog(SESSION);
      const firstIndex = log.findIndex(
        (entry) => findClientMatches(entry, clientConversationId).length > 0
      );
      expect(firstIndex).toBeGreaterThanOrEqual(0);

      const slice = log.slice(firstIndex);
      const counts = slice.map(
        (entry) => findClientMatches(entry, clientConversationId).length
      );
      const maxCount = Math.max(...counts);
      expect(maxCount).toBeLessThanOrEqual(1);
      expect(counts.some((count) => count === 0)).toBe(false);

      const removalWithoutAdd = slice.some((entry) => {
        const removed = entry.removed.some(
          (item) => item.clientConversationId === clientConversationId
        );
        if (!removed) return false;
        return !entry.added.some(
          (item) => item.clientConversationId === clientConversationId
        );
      });
      expect(removalWithoutAdd).toBe(false);

      const messageLog = await readMessageMutationLog(SESSION);
      const firstMessageIndex = messageLog.findIndex((entry) =>
        entry.items.some(
          (item) => item.role === "user" && item.text.includes(message)
        )
      );
      expect(firstMessageIndex).toBeGreaterThanOrEqual(0);

      const messageSlice = messageLog.slice(firstMessageIndex);
      const keysByEntry = messageSlice.map((entry) =>
        entry.items.map((item) => messageKeyFor(item))
      );
      for (const keys of keysByEntry) {
        const unique = new Set(keys);
        expect(unique.size).toBe(keys.length);
      }

      const firstSeen = new Map<string, number>();
      for (let index = 0; index < messageSlice.length; index += 1) {
        for (const item of messageSlice[index].items) {
          const key = messageKeyFor(item);
          if (!firstSeen.has(key)) {
            firstSeen.set(key, index);
          }
        }
      }

      for (const [key, startIndex] of firstSeen) {
        for (let index = startIndex; index < messageSlice.length; index += 1) {
          const entryKeys = new Set(keysByEntry[index]);
          expect(entryKeys.has(key)).toBe(true);
        }
      }

      // Find our user message key
      const userMessageItem = messageSlice[0].items.find(
        (item) => item.role === "user" && item.text.includes(message)
      );
      const ourUserKey = userMessageItem
        ? messageKeyFor(userMessageItem)
        : undefined;

      // Track messages added AFTER our user message first appeared.
      // Only these are part of our test conversation.
      const ourConversationKeys = new Set<string>();
      let userMessageSeen = false;
      for (const entry of messageSlice) {
        // Check if our user message appears in this entry
        const hasOurUser =
          ourUserKey !== undefined &&
          entry.items.some((item) => messageKeyFor(item) === ourUserKey);

        if (hasOurUser && !userMessageSeen) {
          // First entry with our user message - add the user message key
          userMessageSeen = true;
          ourConversationKeys.add(ourUserKey);
        }

        // After seeing user message, track messages that were ADDED (new to DOM)
        if (userMessageSeen) {
          for (const added of entry.added) {
            ourConversationKeys.add(messageKeyFor(added));
          }
        }
      }

      // Only track removals for messages that belong to our conversation.
      // A removal doesn't count as a flash if the same key was re-added in the same batch.
      const seenKeys = new Set<string>();
      for (const entry of messageSlice) {
        for (const item of entry.items) {
          const key = messageKeyFor(item);
          if (ourConversationKeys.has(key)) {
            seenKeys.add(key);
          }
        }
        const addedKeysInEntry = new Set(
          entry.added.map((item) => messageKeyFor(item))
        );
        const removedKeys = entry.removed.map((item) => messageKeyFor(item));
        // A flash is when a message was seen, removed, AND NOT re-added in the same batch
        const removedAfterSeen = removedKeys.some(
          (key) =>
            seenKeys.has(key) &&
            ourConversationKeys.has(key) &&
            !addedKeysInEntry.has(key)
        );
        expect(removedAfterSeen).toBe(false);
      }

      // Verify DOM node identity stability - renderId should not change for a given messageKey.
      // If renderId changes, it means the component was remounted (causes visual flash).
      const renderIdByMessageKey = new Map<string, string>();
      for (const entry of messageSlice) {
        for (const item of entry.items) {
          const msgKey = messageKeyFor(item);
          if (!ourConversationKeys.has(msgKey)) continue;
          if (!item.renderId) continue;

          const existingRenderId = renderIdByMessageKey.get(msgKey);
          if (existingRenderId === undefined) {
            renderIdByMessageKey.set(msgKey, item.renderId);
          } else {
            // renderId should stay the same - if it changes, the component remounted
            expect(item.renderId).toBe(existingRenderId);
          }
        }
      }
    },
    40_000
  );

  it(
    "opens workspace from the header and creates terminals",
    async () => {
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const terminalButtonRef = await waitForRef(SESSION, (entry) => {
        if (entry.role !== "button") return false;
        return entry.name?.trim().toLowerCase() === "terminal";
      });
      await runAgent(["click", `@${terminalButtonRef}`], SESSION);

      await waitForWorkspace(SESSION);
      const workspaceState = await waitForWorkspaceState(
        SESSION,
        (state) => state.hasNewTerminalButton
      );
      expect(workspaceState.hasNewTerminalButton).toBe(true);

      const workspaceTabs = await ensureWorkspaceTabs(SESSION, 1);
      expect(workspaceTabs.tabs.length).toBeGreaterThanOrEqual(1);
    },
    25_000
  );

  it(
    "reorders terminal tabs within a panel",
    async () => {
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const terminalButtonRef = await waitForRef(SESSION, (entry) => {
        if (entry.role !== "button") return false;
        return entry.name?.trim().toLowerCase() === "terminal";
      });
      await runAgent(["click", `@${terminalButtonRef}`], SESSION);
      await waitForWorkspace(SESSION);

      const { kind: tabKind } = await ensureWorkspaceTabs(SESSION, 3);
      const initialState = await waitForWorkspaceState(
        SESSION,
        (state) =>
          state.tabs.filter((tab) => tab.kind === tabKind).length >= 3
      );
      const tabsByPanel = new Map<string, WorkspaceTabInfo[]>();
      for (const tab of initialState.tabs) {
        if (tab.kind !== tabKind || !tab.panelId) continue;
        const list = tabsByPanel.get(tab.panelId) ?? [];
        list.push(tab);
        tabsByPanel.set(tab.panelId, list);
      }
      const panelEntry = Array.from(tabsByPanel.entries()).find(
        ([, tabs]) => tabs.length >= 2
      );
      if (!panelEntry) {
        throw new Error("Expected a panel with at least two terminal tabs");
      }
      const [panelId, panelTabs] = panelEntry;
      const firstTab = panelTabs[0];
      const lastTab = panelTabs[panelTabs.length - 1];
      if (!firstTab || !lastTab) {
        throw new Error("Missing terminal tabs for reorder");
      }

      await dragWorkspaceTabToTab(SESSION, lastTab.id, firstTab.id);
      await waitForWorkspaceState(SESSION, (state) => {
        const ordered = state.tabs.filter(
          (tab) => tab.panelId === panelId && tab.kind === tabKind
        );
        return ordered[0]?.id === lastTab.id;
      });
    },
    30_000
  );

  it(
    "splits a panel and moves tabs across panels",
    async () => {
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const terminalButtonRef = await waitForRef(SESSION, (entry) => {
        if (entry.role !== "button") return false;
        return entry.name?.trim().toLowerCase() === "terminal";
      });
      await runAgent(["click", `@${terminalButtonRef}`], SESSION);
      await waitForWorkspace(SESSION);

      const { kind: tabKind } = await ensureWorkspaceTabs(SESSION, 2);
      const startState = await waitForWorkspaceState(
        SESSION,
        (state) =>
          state.tabs.filter((tab) => tab.kind === tabKind).length >= 2
      );
      const tabsByPanel = new Map<string, WorkspaceTabInfo[]>();
      for (const tab of startState.tabs) {
        if (tab.kind !== tabKind || !tab.panelId) continue;
        const list = tabsByPanel.get(tab.panelId) ?? [];
        list.push(tab);
        tabsByPanel.set(tab.panelId, list);
      }
      const panelEntry = Array.from(tabsByPanel.entries()).find(
        ([, tabs]) => tabs.length >= 2
      );
      if (!panelEntry) {
        throw new Error("Expected a panel with at least two terminal tabs");
      }
      const [panelId, panelTabs] = panelEntry;
      const tabToSplit = panelTabs[1] ?? panelTabs[0];
      if (!tabToSplit) {
        throw new Error("Missing terminal tab to split");
      }

      const splitState = await ensureSplitPanel(
        SESSION,
        tabToSplit.id,
        panelId,
        "right"
      );
      const targetPanelId =
        splitState.tabs.find((tab) => tab.id === tabToSplit.id)?.panelId ??
        null;
      if (!targetPanelId) {
        throw new Error("Split did not create a target panel");
      }

      const sourceTab = splitState.tabs.find(
        (tab) =>
          tab.kind === tabKind &&
          tab.id !== tabToSplit.id &&
          tab.panelId !== targetPanelId &&
          tab.panelId !== null
      );
      if (!sourceTab) {
        throw new Error("Missing source tab to move");
      }

      await dragWorkspaceTabToPanelCenter(
        SESSION,
        sourceTab.id,
        targetPanelId
      );
      await waitForWorkspaceState(SESSION, (state) => {
        const moved = state.tabs.find((tab) => tab.id === sourceTab.id);
        return moved?.panelId === targetPanelId;
      });
    },
    35_000
  );

  it(
    "collapses empty panels after moving tabs between panels",
    async () => {
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const terminalButtonRef = await waitForRef(SESSION, (entry) => {
        if (entry.role !== "button") return false;
        return entry.name?.trim().toLowerCase() === "terminal";
      });
      await runAgent(["click", `@${terminalButtonRef}`], SESSION);
      await waitForWorkspace(SESSION);

      const { kind: tabKind } = await ensureWorkspaceTabs(SESSION, 2);
      const initialState = await waitForWorkspaceState(
        SESSION,
        (state) =>
          state.tabs.filter((tab) => tab.kind === tabKind).length >= 2
      );
      const tabsByPanel = new Map<string, WorkspaceTabInfo[]>();
      for (const tab of initialState.tabs) {
        if (tab.kind !== tabKind || !tab.panelId) continue;
        const list = tabsByPanel.get(tab.panelId) ?? [];
        list.push(tab);
        tabsByPanel.set(tab.panelId, list);
      }
      const panelEntry = Array.from(tabsByPanel.entries()).find(
        ([, tabs]) => tabs.length >= 2
      );
      if (!panelEntry) {
        throw new Error("Expected a panel with at least two terminal tabs");
      }
      const [panelId, panelTabs] = panelEntry;
      const tabToSplit = panelTabs[1] ?? panelTabs[0];
      if (!tabToSplit) {
        throw new Error("Missing terminal tab to split");
      }

      const splitState = await ensureSplitPanel(
        SESSION,
        tabToSplit.id,
        panelId,
        "right"
      );
      const targetPanelId =
        splitState.tabs.find((tab) => tab.id === tabToSplit.id)?.panelId ??
        null;
      if (!targetPanelId) {
        throw new Error("Split did not create a target panel");
      }
      const sourceTab = splitState.tabs.find(
        (tab) =>
          tab.kind === tabKind &&
          tab.id !== tabToSplit.id &&
          tab.panelId !== targetPanelId &&
          tab.panelId !== null
      );
      if (!sourceTab) {
        throw new Error("Missing source tab to move into target panel");
      }

      await dragWorkspaceTabToPanelCenter(
        SESSION,
        sourceTab.id,
        targetPanelId
      );
      const movedState = await waitForWorkspaceState(
        SESSION,
        (state) => {
          const moved = state.tabs.find((entry) => entry.id === sourceTab.id);
          return Boolean(
            moved &&
              moved.panelId === targetPanelId &&
              state.panelIds.length === 1
          );
        },
        6_000
      );

      const emptyPanels = getEmptyPanelIds(movedState);
      expect(emptyPanels.length).toBe(0);
      await assertPanelRectsSane(SESSION);
    },
    40_000
  );

  it(
    "resizes workspace and split panels",
    async () => {
      const baseUrl = buildE2EUrl(createResetToken());
      await runAgent(["open", baseUrl], SESSION);
      await runAgent(["set", "viewport", "1400", "900"], SESSION);
      await runAgent(
        ["eval", "localStorage.setItem('cmux:conversation-workspace-width','440')"],
        SESSION
      );
      await runAgent(["reload"], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const terminalButtonRef = await waitForRef(SESSION, (entry) => {
        if (entry.role !== "button") return false;
        return entry.name?.trim().toLowerCase() === "terminal";
      });
      await runAgent(["click", `@${terminalButtonRef}`], SESSION);
      await waitForWorkspace(SESSION);

      const initialWorkspaceRect = await getElementRect(
        SESSION,
        "[data-workspace-container]"
      );
      const resizeHandleSelector = "[data-workspace-resize-handle]";
      await dragHandleBy(
        SESSION,
        resizeHandleSelector,
        -140,
        0
      );
      let resizedWorkspaceRect: Rect | null = null;
      try {
        resizedWorkspaceRect = await waitForWidthChange(
          SESSION,
          "[data-workspace-container]",
          initialWorkspaceRect.width,
          40
        );
      } catch (error) {
        console.error("Workspace resize drag did not change width", error);
        await dragWorkspaceResizeHandleSynthetic(
          SESSION,
          resizeHandleSelector,
          -140
        );
        resizedWorkspaceRect = await waitForWidthChange(
          SESSION,
          "[data-workspace-container]",
          initialWorkspaceRect.width,
          20
        );
      }
      expect(resizedWorkspaceRect.width).toBeGreaterThan(
        initialWorkspaceRect.width
      );

      const { kind: tabKind } = await ensureWorkspaceTabs(SESSION, 2);
      const initialState = await waitForWorkspaceState(
        SESSION,
        (state) =>
          state.tabs.filter((tab) => tab.kind === tabKind).length >= 2
      );
      const tabsByPanel = new Map<string, WorkspaceTabInfo[]>();
      for (const tab of initialState.tabs) {
        if (tab.kind !== tabKind || !tab.panelId) continue;
        const list = tabsByPanel.get(tab.panelId) ?? [];
        list.push(tab);
        tabsByPanel.set(tab.panelId, list);
      }
      const panelEntry = Array.from(tabsByPanel.entries()).find(
        ([, tabs]) => tabs.length >= 2
      );
      if (!panelEntry) {
        throw new Error("Expected a panel with at least two tabs");
      }
      const [panelId, panelTabs] = panelEntry;
      const tabToSplit = panelTabs[1] ?? panelTabs[0];
      if (!tabToSplit) {
        throw new Error("Missing tab to split");
      }

      await ensureSplitPanel(SESSION, tabToSplit.id, panelId, "right");
      await waitForWorkspaceState(
        SESSION,
        (state) => state.panelIds.length >= 2
      );

      const handleDirection = await getSplitHandleDirection(SESSION);
      const handleSelector = `[data-workspace-split-handle][data-workspace-split-direction="${handleDirection}"]`;
      const rootBefore = await readWorkspaceRootFromE2E(SESSION);
      if (!rootBefore) {
        throw new Error("Missing workspace layout for split resize");
      }
      const splitBefore = findFirstSplit(rootBefore);
      if (!splitBefore) {
        throw new Error("Missing split layout for resize");
      }
      await dragHandleBy(
        SESSION,
        handleSelector,
        handleDirection === "row" ? 120 : 0,
        handleDirection === "column" ? 120 : 0
      );
      try {
        await waitForSplitSizesChange(SESSION, splitBefore.sizes);
      } catch (error) {
        console.error("Split resize drag did not change sizes", error);
        await dragSplitHandleSynthetic(
          SESSION,
          handleSelector,
          handleDirection === "row" ? 120 : 0,
          handleDirection === "column" ? 120 : 0
        );
        await waitForSplitSizesChange(SESSION, splitBefore.sizes, 0.02);
      }
    },
    40_000
  );
});
