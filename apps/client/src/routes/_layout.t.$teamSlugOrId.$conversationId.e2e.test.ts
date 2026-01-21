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
  timeoutMs = 12_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await runAgent(["get", "url"], session);
    if (predicate(url)) return url;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for url condition");
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

async function waitForMessage(session: string, message: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
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

      if (otherConversationEntry) {
        await runAgent(["click", `@${otherConversationEntry[0]}`], SESSION);
      } else {
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

      const seenKeys = new Set<string>();
      for (const entry of messageSlice) {
        for (const item of entry.items) {
          seenKeys.add(messageKeyFor(item));
        }
        const removedKeys = entry.removed.map((item) => messageKeyFor(item));
        const removedAfterSeen = removedKeys.some((key) => seenKeys.has(key));
        expect(removedAfterSeen).toBe(false);
      }
    },
    40_000
  );
});
