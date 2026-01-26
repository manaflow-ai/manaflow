import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  useAction,
  useConvex,
  useMutation,
  useQuery,
} from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import type { SetStateAction } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import clsx from "clsx";
import { Streamdown } from "streamdown";
import {
  useAcpSandboxStream,
  type AcpStreamStatus,
} from "@/hooks/useAcpSandboxStream";
import { useSendMessageOptimistic } from "@/hooks/useSendMessageOptimistic";
import {
  ChatLayout,
  MessageWrapper,
  StreamingMessageWrapper,
  ComposerVariant,
  HeaderVariant,
} from "@/components/chat-layouts";
import { isConversationManualUnread } from "@/lib/conversationReadOverrides";

const OPTIMISTIC_CONVERSATION_PREFIX = "client-";
const optimisticStateSchema = z.object({
  optimisticText: z.string().nullable().optional(),
  optimisticClientMessageId: z.string().nullable().optional(),
  optimisticCreatedAt: z.number().optional(),
  optimisticClientConversationId: z.string().nullable().optional(),
});
const conversationIdSchema = z.custom<Id<"conversations">>(
  (value) => typeof value === "string"
);
const storageIdSchema = z.custom<Id<"_storage">>(
  (value) => typeof value === "string"
);
const uploadResponseSchema = z.object({ storageId: storageIdSchema });

const searchSchema = z.object({});

export const Route = createFileRoute(
  "/_layout/t/$teamSlugOrId/$conversationId"
)({
  component: ConversationThread,
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    const { teamSlugOrId, conversationId } = params;
    // Skip prewarming for optimistic (client-side) conversations
    if (conversationId.startsWith(OPTIMISTIC_CONVERSATION_PREFIX)) {
      return;
    }
    // Prewarm the full conversation query
    convexQueryClient.convexClient.prewarmQuery({
      query: api.conversations.getFullConversation,
      args: {
        teamSlugOrId,
        conversationId: conversationId as Id<"conversations">,
      },
    });
  },
});

// Debug logging for conversation caching
const DEBUG_CACHE = false;
function debugCache(label: string, data: Record<string, unknown>) {
  if (DEBUG_CACHE) {
    console.log(`[ConvCache] ${label}`, {
      ...data,
      _ts: Date.now(),
    });
  }
}

type ConversationSandboxStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "offline"
  | "error";

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type ContentBlock = Doc<"conversationMessages">["content"][number];
type RawEventView = {
  _id: string;
  seq: number;
  raw: string;
  createdAt: number;
  source: "convex" | "sandbox";
};
type StreamingMessage = {
  content: ContentBlock[];
  createdAt: number;
  lastSeq: number;
  // Preamble: text that appeared BEFORE the first tool call
  // This should be rendered above the tool calls section
  preamble?: string;
  preambleSeq?: number; // Sequence of last message_chunk before first tool_call
};

type DraftState = {
  text: string;
  attachments: PendingImage[];
};

const createEmptyDraftState = (): DraftState => ({
  text: "",
  attachments: [],
});

function isUnreadCandidateMessage(
  message: Doc<"conversationMessages">
): boolean {
  if (message.role !== "assistant") return false;

  return message.content.some((block) => {
    if (block.type === "text") {
      return Boolean(block.text?.trim());
    }
    return (
      block.type === "image" ||
      block.type === "audio" ||
      block.type === "resource_link" ||
      block.type === "resource"
    );
  });
}

type PermissionMode = "manual" | "auto_allow_once" | "auto_allow_always";

type PermissionOption = {
  optionId: string;
  name: string;
  kind: string;
};

type PermissionRequest = {
  id: string | number;
  options: PermissionOption[];
  title: string | null;
  description: string | null;
  command: string | null;
};

type ToolCallEntry = {
  id: string;
  title: string | null;
  status: string | null;
  kind: string | null;
  description: string | null;
  command: string | null;
  toolName: string | null;
  outputs: string[];
  firstSeenAt: number;
  firstSeenSeq: number | null;
  hasMeaningfulStart: boolean;
  lastUpdatedAt: number;
  lastUpdatedSeq: number | null;
};

type SandboxMeta = {
  status: ConversationSandboxStatus;
  sandboxUrl: string | null;
  lastActivityAt: number;
};

const providerLabel: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

function ConversationThread() {
  const { teamSlugOrId, conversationId: conversationIdParam } = Route.useParams();
  const location = useLocation();
  const isOptimisticConversation = conversationIdParam.startsWith(
    OPTIMISTIC_CONVERSATION_PREFIX
  );
  const conversationId = conversationIdSchema.parse(conversationIdParam);

  // Debug: log conversation navigation
  const prevConversationIdRef = useRef<string | null>(null);
  const mountIdRef = useRef<string>(crypto.randomUUID().slice(0, 8));
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      debugCache("conversationChange", {
        from: prevConversationIdRef.current,
        to: conversationId,
        mountId: mountIdRef.current,
      });
      prevConversationIdRef.current = conversationId;
    }
  }, [conversationId]);

  // Debug: log mount/unmount
  useEffect(() => {
    const mountId = mountIdRef.current;
    debugCache("mount", { conversationId, mountId });
    return () => {
      debugCache("unmount", { conversationId, mountId });
    };
  }, [conversationId]);

  const optimisticState = useMemo(() => {
    const parsed = optimisticStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);
  const optimisticText = optimisticState?.optimisticText?.trim() ?? "";
  const optimisticClientMessageId =
    optimisticState?.optimisticClientMessageId ?? null;
  const optimisticCreatedAt = optimisticState?.optimisticCreatedAt ?? Date.now();
  const optimisticClientConversationId =
    optimisticState?.optimisticClientConversationId ??
    (isOptimisticConversation
      ? conversationIdParam.slice(OPTIMISTIC_CONVERSATION_PREFIX.length)
      : null);
  // Single query for all conversation data - prewarmed in beforeLoad
  const fullConversation = useQuery(
    api.conversations.getFullConversation,
    isOptimisticConversation
      ? "skip"
      : {
          teamSlugOrId,
          conversationId,
        }
  );

  const conversation = fullConversation?.conversation ?? null;
  const sandbox = fullConversation?.sandbox ?? null;
  const streamInfo = fullConversation?.streamInfo ?? null;

  // Debug: log query states on every render
  debugCache("queryStates", {
    conversationId,
    fullConversation: fullConversation === undefined ? "loading" : "ready",
    messagesCount: fullConversation?.messages?.length ?? null,
    rawEventsCount: fullConversation?.rawEvents?.length ?? null,
  });

  const optimisticMessage = useMemo(() => {
    if (!optimisticText) return null;
    return {
      _id: ((optimisticClientMessageId ??
        `client-message-${optimisticCreatedAt}`) as Id<"conversationMessages">),
      _creationTime: optimisticCreatedAt,
      conversationId: conversationId as Id<"conversations">,
      clientMessageId: optimisticClientMessageId ?? undefined,
      role: "user",
      deliveryStatus: "queued",
      deliveryError: undefined,
      deliverySwapAttempted: false,
      content: [{ type: "text", text: optimisticText }],
      toolCalls: undefined,
      reasoning: undefined,
      acpSeq: undefined,
      isFinal: undefined,
      createdAt: optimisticCreatedAt,
    } satisfies Doc<"conversationMessages">;
  }, [
    conversationId,
    optimisticClientMessageId,
    optimisticCreatedAt,
    optimisticText,
  ]);
  const messages = useMemo(() => {
    return fullConversation?.messages ?? [];
  }, [fullConversation?.messages]);
  const convexRawEvents = useMemo(() => {
    return fullConversation?.rawEvents ?? [];
  }, [fullConversation?.rawEvents]);

  const latestConvexSeq = useMemo(() => {
    if (convexRawEvents.length === 0) return 0;
    return convexRawEvents.reduce(
      (max, event) => (event.seq > max ? event.seq : max),
      0
    );
  }, [convexRawEvents]);
  // TODO: Re-enable ACP stream once streaming preamble rendering is fixed
  const stream = useAcpSandboxStream({
    enabled: false, // Disabled to debug streaming preamble interference
    streamUrl: streamInfo?.sandboxUrl
      ? `${streamInfo.sandboxUrl}/api/acp/stream/${conversationId}`
      : null,
    token: streamInfo?.token ?? null,
    startOffset: latestConvexSeq,
  });
  const streamRawEvents = useMemo<RawEventView[]>(
    () =>
      stream.events.map((event) => ({
        _id: `stream-${event.seq}`,
        seq: event.seq,
        raw: event.raw,
        createdAt: event.createdAt,
        source: "sandbox",
      })),
    [stream.events]
  );
  const rawEvents = useMemo(
    () => mergeRawEvents(convexRawEvents, streamRawEvents),
    [convexRawEvents, streamRawEvents]
  );

  const markRead = useMutation(api.conversationReads.markRead);
  const sendMessage = useSendMessageOptimistic();
  const retryMessage = useAction(api.acp.retryMessage);
  const sendRpc = useAction(api.acp.sendRpc);
  const updatePermissionMode = useMutation(
    api.conversations.updatePermissionMode
  );
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const convex = useConvex();
  const effectivePermissionMode: PermissionMode =
    (conversation?.permissionMode as PermissionMode | undefined) ??
    "auto_allow_always";

  const optimisticConversationKey = optimisticClientConversationId
    ? `${OPTIMISTIC_CONVERSATION_PREFIX}${optimisticClientConversationId}`
    : null;
  const conversationKey =
    optimisticConversationKey ??
    conversation?.clientConversationId ??
    conversationIdParam;
  const conversationResetKey = optimisticConversationKey ?? conversationIdParam;

  const [draftsByConversation, setDraftsByConversation] = useState<
    Map<string, DraftState>
  >(() => new Map());
  const draftsRef = useRef<Map<string, DraftState>>(new Map());
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<number | null>(null);
  const [permissionInFlight, setPermissionInFlight] = useState<string | null>(
    null
  );
  const [dismissedPermissionIds, setDismissedPermissionIds] = useState<
    string[]
  >([]);
  const lastAutoPermissionId = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedAtByConversation = useRef<Map<string, number>>(new Map());
  const currentDraft = draftsByConversation.get(conversationKey) ??
    createEmptyDraftState();
  const text = currentDraft.text;
  const attachments = currentDraft.attachments;

  const updateDraft = useCallback(
    (updater: (draft: DraftState) => DraftState) => {
      setDraftsByConversation((current) => {
        const next = new Map(current);
        const draft = next.get(conversationKey) ?? createEmptyDraftState();
        next.set(conversationKey, updater(draft));
        draftsRef.current = next;
        return next;
      });
    },
    [conversationKey]
  );

  const setText = useCallback(
    (value: string) => {
      updateDraft((draft) =>
        draft.text === value ? draft : { ...draft, text: value }
      );
    },
    [updateDraft]
  );

  const setAttachments = useCallback(
    (value: SetStateAction<PendingImage[]>) => {
      updateDraft((draft) => {
        const next =
          typeof value === "function" ? value(draft.attachments) : value;
        return { ...draft, attachments: next };
      });
    },
    [updateDraft]
  );


  const latestReadableMessageAt = useMemo(() => {
    for (const message of messages) {
      if (isUnreadCandidateMessage(message)) {
        return message.createdAt;
      }
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (isOptimisticConversation) return;
    if (!latestReadableMessageAt) return;
    if (typeof document === "undefined") return;

    const firstMessageConversationId = messages[0]?.conversationId;
    if (messages.length > 0 && firstMessageConversationId !== conversationId) {
      return;
    }

    const markReadIfFocused = () => {
      const isFocused = document.hasFocus();
      if (!isFocused) {
        return;
      }
      if (isConversationManualUnread(conversationId)) {
        return;
      }
      const lastMarkedAt = lastMarkedAtByConversation.current.get(
        conversationId
      );
      if (lastMarkedAt !== undefined && latestReadableMessageAt <= lastMarkedAt) {
        return;
      }

      lastMarkedAtByConversation.current.set(
        conversationId,
        latestReadableMessageAt
      );
      void markRead({
        teamSlugOrId,
        conversationId,
        lastReadAt: latestReadableMessageAt,
      }).catch((error) => {
        console.error("Failed to mark conversation read", error);
      });
    };

    markReadIfFocused();
    window.addEventListener("focus", markReadIfFocused);
    return () => window.removeEventListener("focus", markReadIfFocused);
  }, [
    conversationId,
    isOptimisticConversation,
    latestReadableMessageAt,
    markRead,
    messages,
    teamSlugOrId,
  ]);


  // Note: pagination removed - we now fetch all messages in one query

  useEffect(() => {
    return () => {
      draftsRef.current.forEach((draft) => {
        draft.attachments.forEach((attachment) => {
          URL.revokeObjectURL(attachment.previewUrl);
        });
      });
    };
  }, []);

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;

    const nextAttachments: PendingImage[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image uploads are supported right now.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error("Images must be under 8MB.");
        return;
      }
      nextAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });

    if (nextAttachments.length > 0) {
      setAttachments((current) => [...current, ...nextAttachments]);
    }
  };

  const handleSend = useCallback(async () => {
    if (isSending) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const previousText = text;
    const previousAttachments = attachments;
    const clientMessageId = crypto.randomUUID();
    const attachmentsToUpload = [...attachments];

    setIsSending(true);
    setLastSubmittedAt(Date.now());
    setText("");
    setAttachments([]);

    try {
      const uploaded = await Promise.all(
        attachmentsToUpload.map(async (attachment) => {
          const uploadUrl = await generateUploadUrl({ teamSlugOrId });
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": attachment.file.type,
            },
            body: attachment.file,
          });
          const json = await response.json();
          const parsed = uploadResponseSchema.safeParse(json);
          if (!parsed.success) {
            console.error("Invalid upload response", parsed.error);
            throw new Error("Failed to upload image");
          }
          const fileUrl = await convex.query(api.storage.getUrl, {
            teamSlugOrId,
            storageId: parsed.data.storageId,
          });
          return {
            url: fileUrl,
            name: attachment.file.name,
            mimeType: attachment.file.type,
          };
        })
      );

      const content: Array<{
        type: "text" | "resource_link";
        text?: string;
        uri?: string;
        name?: string;
        mimeType?: string;
      }> = [];

      if (trimmed) {
        content.push({ type: "text", text: trimmed });
      }

      uploaded.forEach((item) => {
        content.push({
          type: "resource_link",
          uri: item.url,
          name: item.name,
          mimeType: item.mimeType,
        });
      });

      await sendMessage({
        teamSlugOrId,
        conversationId,
        content,
        clientMessageId,
      });

      attachmentsToUpload.forEach((attachment) => {
        URL.revokeObjectURL(attachment.previewUrl);
      });
    } catch (error) {
      console.error("Failed to send message", error);
      setText(previousText);
      setAttachments(previousAttachments);
      toast.error("Failed to send message");
    } finally {
      setIsSending(false);
    }
  }, [
    attachments,
    conversationId,
    convex,
    generateUploadUrl,
    isSending,
    sendMessage,
    setAttachments,
    setText,
    teamSlugOrId,
    text,
  ]);

  const handleRetryMessage = useCallback(
    async (messageId: Id<"conversationMessages">) => {
      try {
        const result = await retryMessage({ conversationId, messageId });
        if (result.status === "error") {
          toast.error(result.error ?? "Delivery failed");
        }
      } catch (error) {
        console.error("Failed to retry message", error);
        toast.error("Failed to retry message");
      }
    },
    [conversationId, retryMessage]
  );

  const shouldUseOptimisticMessage =
    Boolean(optimisticMessage && optimisticClientConversationId) &&
    (isOptimisticConversation ||
      conversation === null ||
      conversation?.clientConversationId === optimisticClientConversationId);

  const visibleMessages = useMemo(() => {
    if (!shouldUseOptimisticMessage || !optimisticMessage) {
      return messages;
    }
    const matchesClientId =
      optimisticMessage.clientMessageId &&
      messages.some(
        (message) =>
          message.clientMessageId === optimisticMessage.clientMessageId
      );
    if (matchesClientId) {
      return messages;
    }
    return [optimisticMessage, ...messages];
  }, [messages, optimisticMessage, shouldUseOptimisticMessage]);

  const toolCalls = useMemo<ToolCallEntry[]>(() => {
    if (rawEvents.length === 0) return [];
    const entries = new Map<string, ToolCallEntry>();
    const ordered = [...rawEvents].sort((a, b) => a.seq - b.seq);

    for (const event of ordered) {
      const parsed = safeParseJson(event.raw);
      if (!parsed || !isRecord(parsed)) continue;
      const method = typeof parsed.method === "string" ? parsed.method : null;
      if (method !== "session/update") continue;
      const params = parsed.params;
      if (!isRecord(params)) continue;
      const update = params.update;
      if (!isRecord(update)) continue;
      const sessionUpdate =
        typeof update.sessionUpdate === "string" ? update.sessionUpdate : null;
      if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
        continue;
      }
      const toolCallId =
        typeof update.toolCallId === "string" ? update.toolCallId : null;
      if (!toolCallId) continue;

      const existing =
        entries.get(toolCallId) ??
        ({
          id: toolCallId,
          title: null,
          status: null,
          kind: null,
          description: null,
          command: null,
          toolName: null,
          outputs: [],
          firstSeenAt: event.createdAt,
          firstSeenSeq: typeof event.seq === "number" ? event.seq : null,
          hasMeaningfulStart: false,
          lastUpdatedAt: event.createdAt,
          lastUpdatedSeq: typeof event.seq === "number" ? event.seq : null,
        } satisfies ToolCallEntry);

      if (typeof update.title === "string") {
        existing.title = update.title;
      }
      if (typeof update.status === "string") {
        existing.status = update.status;
      }
      if (typeof update.kind === "string") {
        existing.kind = update.kind;
      }

      const rawInput = isRecord(update.rawInput) ? update.rawInput : null;
      const hasMeaningfulInput =
        (rawInput && typeof rawInput.command === "string") ||
        (rawInput && typeof rawInput.description === "string") ||
        (typeof update.title === "string" && update.title !== "Terminal");
      if (rawInput) {
        if (typeof rawInput.description === "string") {
          existing.description = rawInput.description;
        }
        if (typeof rawInput.command === "string") {
          existing.command = rawInput.command;
        }
      }

      const meta = isRecord(update._meta) ? update._meta : null;
      const claudeCode = meta && isRecord(meta.claudeCode) ? meta.claudeCode : null;
      if (claudeCode) {
        if (typeof claudeCode.toolName === "string") {
          existing.toolName = claudeCode.toolName;
        }
        const toolResponse = isRecord(claudeCode.toolResponse)
          ? claudeCode.toolResponse
          : null;
        if (toolResponse) {
          const stdout = toolResponse.stdout;
          const stderr = toolResponse.stderr;
          if (typeof stdout === "string" && stdout.trim().length > 0) {
            appendUnique(existing.outputs, stdout.trim());
          }
          if (typeof stderr === "string" && stderr.trim().length > 0) {
            appendUnique(existing.outputs, `stderr:\n${stderr.trim()}`);
          }
        }
      }

      const content = Array.isArray(update.content) ? update.content : [];
      for (const item of content) {
        const text = extractTextFromContent(item);
        if (text) {
          appendUnique(existing.outputs, text);
        }
      }

      existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt, event.createdAt);
      if (typeof event.seq === "number") {
        existing.firstSeenSeq =
          existing.firstSeenSeq === null
            ? event.seq
            : Math.min(existing.firstSeenSeq, event.seq);
        existing.lastUpdatedSeq =
          existing.lastUpdatedSeq === null
            ? event.seq
            : Math.max(existing.lastUpdatedSeq, event.seq);
      }
      if (hasMeaningfulInput && !existing.hasMeaningfulStart) {
        existing.hasMeaningfulStart = true;
        existing.firstSeenAt = event.createdAt;
        existing.firstSeenSeq =
          typeof event.seq === "number" ? event.seq : existing.firstSeenSeq;
      }
      entries.set(toolCallId, existing);
    }

    return [...entries.values()].sort(
      (a, b) => b.firstSeenAt - a.firstSeenAt
    );
  }, [rawEvents]);

  const messageToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of visibleMessages) {
      for (const call of message.toolCalls ?? []) {
        ids.add(call.id);
      }
    }
    return ids;
  }, [visibleMessages]);

  const lastAssistantSeq = useMemo(() => {
    const seqs = visibleMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.acpSeq)
      .filter((seq): seq is number => typeof seq === "number");
    if (seqs.length === 0) return 0;
    return Math.max(...seqs);
  }, [visibleMessages]);

  const streamingMessage = useMemo(
    () => buildStreamingMessage(rawEvents, lastAssistantSeq),
    [rawEvents, lastAssistantSeq]
  );

  const combinedItems = useMemo(() => {
    const streamItems: Array<
      | { kind: "stream"; createdAt: number; sortSeq: number; message: StreamingMessage }
      | { kind: "stream-preamble"; createdAt: number; sortSeq: number; text: string }
    > = [];

    if (streamingMessage) {
      // If streaming has preamble (text before first tool call), emit it as separate item
      // Preamble has lower seq than tools, so it will sort AFTER tools in the array
      // With flex-col-reverse, that means preamble appears ABOVE tool calls
      if (streamingMessage.preamble && streamingMessage.preambleSeq !== undefined) {
        streamItems.push({
          kind: "stream-preamble" as const,
          createdAt: streamingMessage.createdAt,
          sortSeq: streamingMessage.preambleSeq,
          text: streamingMessage.preamble,
        });
      }

      // Main streaming content (text after tool calls, or all text if no tools)
      // Only include if there's actual content to show
      const hasContent = streamingMessage.content.some(
        (b) => b.type === "text" && b.text && b.text.trim().length > 0
      );
      if (hasContent) {
        streamItems.push({
          kind: "stream" as const,
          createdAt: streamingMessage.createdAt,
          sortSeq: streamingMessage.lastSeq,
          message: streamingMessage,
        });
      }
    }

    const serverItems = visibleMessages.map((message) => ({
      kind: "server" as const,
      createdAt: message.createdAt,
      sortSeq: typeof message.acpSeq === "number" ? message.acpSeq : null,
      message,
    }));
    const toolItems = toolCalls
      .filter((toolCall) => !messageToolCallIds.has(toolCall.id))
      .map((toolCall) => ({
        kind: "tool" as const,
        createdAt: toolCall.firstSeenAt,
        sortSeq: toolCall.firstSeenSeq,
        toolCall,
      }));

    return [...streamItems, ...serverItems, ...toolItems].sort((a, b) => {
      // Both have sequence numbers - sort by sequence (higher = newer = comes first)
      if (a.sortSeq !== null && b.sortSeq !== null) {
        if (a.sortSeq !== b.sortSeq) return b.sortSeq - a.sortSeq;
      }

      // One has sequence, one doesn't (e.g., user message vs ACP event)
      // User messages (no sortSeq) should come BEFORE ACP events that are responses to them.
      // If ACP event has higher createdAt, user message should come before it.
      // If they're close in time (within 5 seconds), prefer putting user message first.
      if (a.sortSeq === null && b.sortSeq !== null) {
        // a is user message, b is ACP event
        // If b was created after a (or within 5s), a should come first (return positive)
        if (b.createdAt >= a.createdAt - 5000) return 1;
      }
      if (b.sortSeq === null && a.sortSeq !== null) {
        // b is user message, a is ACP event
        // If a was created after b (or within 5s), b should come first (return negative)
        if (a.createdAt >= b.createdAt - 5000) return -1;
      }

      // Fall back to createdAt comparison
      const byCreatedAt = b.createdAt - a.createdAt;
      if (byCreatedAt !== 0) return byCreatedAt;

      // Final tiebreaker
      const aSeq = a.sortSeq ?? 0;
      const bSeq = b.sortSeq ?? 0;
      if (aSeq !== bSeq) return bSeq - aSeq;
      return 0;
    });
  }, [messageToolCallIds, streamingMessage, toolCalls, visibleMessages]);

  const latestUserMessageAt = useMemo(() => {
    const serverUser = visibleMessages
      .filter(
        (message) =>
          message.role === "user" && message.deliveryStatus !== "error"
      )
      .map((message) => message.createdAt);
    if (serverUser.length === 0) return null;
    return Math.max(...serverUser);
  }, [visibleMessages]);

  const latestAssistantMessageAt = useMemo(() => {
    const assistant = visibleMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.createdAt);
    if (assistant.length === 0) return null;
    return Math.max(...assistant);
  }, [visibleMessages]);

  const isAwaitingResponse =
    latestUserMessageAt !== null &&
    (latestAssistantMessageAt === null ||
      latestUserMessageAt > latestAssistantMessageAt);

  const latestUserMessageError = useMemo(() => {
    const userMessages = visibleMessages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return null;
    const latest = userMessages.reduce((a, b) =>
      a.createdAt > b.createdAt ? a : b
    );
    if (latest.deliveryStatus === "error") {
      return latest.deliveryError ?? "Delivery failed";
    }
    return null;
  }, [visibleMessages]);

  const permissionRequest = useMemo<PermissionRequest | null>(() => {
    // First, collect all permission request IDs that have already been responded to
    const respondedIds = new Set<string>();
    for (const event of rawEvents) {
      const parsed = safeParseJson(event.raw);
      if (!parsed || !isRecord(parsed)) continue;
      // A response has "result" field and an "id" that matches the request
      if (isRecord(parsed.result) && (typeof parsed.id === "string" || typeof parsed.id === "number")) {
        respondedIds.add(parsed.id.toString());
      }
    }

    for (const event of rawEvents) {
      const parsed = safeParseJson(event.raw);
      if (!parsed || !isRecord(parsed)) continue;
      const method = typeof parsed.method === "string" ? parsed.method : null;
      if (method !== "session/request_permission") continue;
      const id = parsed.id;
      if (typeof id !== "string" && typeof id !== "number") continue;
      
      // Skip if this permission request has already been responded to
      if (respondedIds.has(id.toString())) continue;
      
      const params = parsed.params;
      if (!isRecord(params)) continue;
      const optionsRaw = params.options;
      if (!Array.isArray(optionsRaw)) continue;
      const options = optionsRaw
        .map((option) => {
          if (!isRecord(option)) return null;
          const optionId =
            typeof option.optionId === "string" ? option.optionId : null;
          const name = typeof option.name === "string" ? option.name : null;
          const kind = typeof option.kind === "string" ? option.kind : null;
          if (!optionId || !name || !kind) return null;
          return { optionId, name, kind };
        })
        .filter((option): option is PermissionOption => option !== null);
      if (options.length === 0) continue;
      const toolCall = isRecord(params.toolCall) ? params.toolCall : null;
      const rawInput =
        toolCall && isRecord(toolCall.rawInput) ? toolCall.rawInput : null;

      return {
        id,
        options,
        title: toolCall && typeof toolCall.title === "string" ? toolCall.title : null,
        description:
          rawInput && typeof rawInput.description === "string"
            ? rawInput.description
            : null,
        command:
          rawInput && typeof rawInput.command === "string"
            ? rawInput.command
            : null,
      };
    }
    return null;
  }, [rawEvents]);

  const activePermissionRequest =
    permissionRequest &&
    !dismissedPermissionIds.includes(permissionRequest.id.toString())
      ? permissionRequest
      : null;


  const handlePermissionDecision = useCallback(async (optionId: string) => {
    if (!activePermissionRequest) return;
    const requestId = activePermissionRequest.id.toString();
    setPermissionInFlight(requestId);
    try {
      const payload = {
        jsonrpc: "2.0",
        id: activePermissionRequest.id,
        result: {
          outcome: {
            outcome: "selected",
            optionId,
          },
        },
      };
      const result = await sendRpc({
        conversationId,
        payload: JSON.stringify(payload),
      });
      if (result.status === "error") {
        toast.error(result.error ?? "Failed to send permission response");
        return;
      }
      setDismissedPermissionIds((current) => [...current, requestId]);
      toast.success("Permission response sent");
    } catch (error) {
      console.error("Failed to send permission response", error);
      toast.error("Failed to send permission response");
    } finally {
      setPermissionInFlight(null);
    }
  }, [activePermissionRequest, conversationId, sendRpc]);

  useEffect(() => {
    if (!activePermissionRequest) return;
    if (effectivePermissionMode === "manual") return;
    const requestId = activePermissionRequest.id.toString();
    if (lastAutoPermissionId.current === requestId) return;

    const preferAlways = effectivePermissionMode === "auto_allow_always";
    const preferredOption = activePermissionRequest.options.find((option) =>
      preferAlways ? option.kind === "allow_always" : option.kind === "allow_once"
    );
    const fallbackOption = activePermissionRequest.options.find(
      (option) => option.kind === "allow_once"
    );
    const optionId = preferredOption?.optionId ?? fallbackOption?.optionId;
    if (!optionId) return;

    lastAutoPermissionId.current = requestId;
    void handlePermissionDecision(optionId);
  }, [activePermissionRequest, effectivePermissionMode, handlePermissionDecision]);

  const providerId = conversation?.providerId ?? "claude";
  const providerName = providerLabel[providerId] ?? "Agent";
  const modelLabel = conversation?.modelId ?? "default";
  const cwd = conversation?.cwd ?? "/root";
  const sandboxMeta: SandboxMeta | null = sandbox
    ? {
        status: sandbox.status,
        sandboxUrl: sandbox.sandboxUrl ?? null,
        lastActivityAt: sandbox.lastActivityAt,
      }
    : null;

  const headerContent = (
    <HeaderVariant
      providerName={providerName}
      cwd={cwd}
      modelLabel={modelLabel}
      sandbox={sandboxMeta}
      showRawEvents={showRawEvents}
      onToggleRawEvents={() => setShowRawEvents((current) => !current)}
      permissionMode={effectivePermissionMode}
      onPermissionModeChange={(mode) => {
        void updatePermissionMode({
          conversationId,
          permissionMode: mode,
        }).catch((error) => {
          console.error("Failed to update permission mode", error);
          toast.error("Failed to update permission mode");
        });
      }}
    />
  );

  // Use lastSubmittedAt if set (user just submitted), otherwise fall back to persisted data:
  // - optimisticCreatedAt for new conversations
  // - latestUserMessageAt for existing conversations awaiting response (persists across navigation)
  const submittedAt = lastSubmittedAt
    ?? (shouldUseOptimisticMessage ? optimisticCreatedAt : null)
    ?? (isAwaitingResponse ? latestUserMessageAt : null);
  const showTimingOrError = (isAwaitingResponse || isOptimisticConversation || latestUserMessageError) && submittedAt !== null;

  const isIntermediateAssistantMessage = (message: Doc<"conversationMessages">) =>
    message.role === "assistant" && message.isFinal !== true;

  const messagesContent = (
    <>
      {showTimingOrError && (
        <SubmissionTimingDisplay submittedAt={submittedAt} error={latestUserMessageError} />
      )}
      {combinedItems.map((item, index) => {
        if (item.kind === "stream") {
          return (
            <StreamingConversationMessage
              key={`stream-${item.message.createdAt}`}
              message={item.message}
            />
          );
        }
        if (item.kind === "stream-preamble") {
          return (
            <StreamingPreambleMessage
              key={`preamble-${index}`}
              text={item.text}
            />
          );
        }
        if (item.kind === "tool") {
          return (
            <ToolCallMessage
              key={`tool-${item.toolCall.id}`}
              call={item.toolCall}
            />
          );
        }
        if (isIntermediateAssistantMessage(item.message)) {
          return (
            <ThinkingMessage
              key={`thinking-${item.message._id}`}
              message={item.message}
            />
          );
        }
        return (
          <ConversationMessage
            key={`message-${item.message.clientMessageId ?? item.message._id}`}
            message={item.message}
            isOwn={item.message.role === "user"}
            onRetry={
              item.message.role === "user" &&
              item.message.deliveryStatus === "error"
                ? () => handleRetryMessage(item.message._id)
                : undefined
            }
          />
        );
      })}
    </>
  );

  const composerContent = (
    <ComposerVariant
      text={text}
      setText={setText}
      attachments={attachments}
      setAttachments={setAttachments}
      onAttachFiles={handleAttachFiles}
      onSend={handleSend}
      isSending={isSending}
      isLocked={isOptimisticConversation}
      autoFocusKey={conversationIdParam}
    />
  );

  const permissionPromptContent =
    activePermissionRequest && effectivePermissionMode === "manual" ? (
      <PermissionPrompt
        request={activePermissionRequest}
        busy={permissionInFlight === activePermissionRequest.id.toString()}
        onSelect={handlePermissionDecision}
      />
    ) : null;

  const hasVisibleMessages = visibleMessages.length > 0;
  const isDataReadyNow =
    isOptimisticConversation ||
    hasVisibleMessages ||
    fullConversation !== undefined;

  // Defer the "not ready" state to give Convex a chance to return cached data
  // on the second render before showing the loading spinner
  const deferredIsDataReady = useDeferredValue(isDataReadyNow);
  const isDataReady = isDataReadyNow || deferredIsDataReady;

  // Debug: log data ready computation
  debugCache("isDataReady", {
    conversationId,
    isDataReady,
    isDataReadyNow,
    deferredIsDataReady,
    isOptimisticConversation,
    hasVisibleMessages,
    visibleMessagesCount: visibleMessages.length,
    fullConversationDefined: fullConversation !== undefined,
  });

  // Show loading state while waiting for initial data
  if (!isDataReady) {
    debugCache("showingLoading", { conversationId });
    return (
      <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ChatLayout
            header={headerContent}
            messages={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            }
            composer={composerContent}
            permissionPrompt={permissionPromptContent}
            scrollContainerRef={scrollContainerRef}
            loadMoreRef={loadMoreRef}
            isLoadingMore={false}
            resetKey={conversationResetKey}
          />
        </div>
      </div>
    );
  }

  // Data is ready - render the full chat with scroll-to-bottom on mount
  return (
    <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <ChatLayout
          header={headerContent}
          messages={messagesContent}
          composer={composerContent}
          permissionPrompt={permissionPromptContent}
          scrollContainerRef={scrollContainerRef}
          loadMoreRef={loadMoreRef}
          isLoadingMore={false}
          scrollToBottomOnMount
          resetKey={conversationResetKey}
        />
      </div>

      {showRawEvents ? (
        <RawAcpEventsPanel
          rawEvents={rawEvents}
          streamStatus={stream.status}
        />
      ) : null}
    </div>
  );
}

function StreamingConversationMessage({
  message,
}: {
  message: StreamingMessage;
}) {
  return (
    <StreamingMessageWrapper>
      <MessageContent blocks={message.content} renderMarkdown isStreaming />
    </StreamingMessageWrapper>
  );
}

/**
 * Renders the preamble text (assistant's initial response before any tool calls).
 * This appears above the tool calls section during streaming.
 */
function StreamingPreambleMessage({ text }: { text: string }) {
  return (
    <StreamingMessageWrapper>
      <MessageContent
        blocks={[{ type: "text", text }]}
        renderMarkdown
        isStreaming={false}
      />
    </StreamingMessageWrapper>
  );
}

function ConversationMessage({
  message,
  isOwn,
  onRetry,
}: {
  message: Doc<"conversationMessages">;
  isOwn: boolean;
  onRetry?: () => void;
}) {
  const timeLabel = formatDistanceToNow(new Date(message.createdAt), {
    addSuffix: true,
  });

  const footer = isOwn ? (
    <MessageDeliveryStatus
      status={message.deliveryStatus}
      error={message.deliveryError}
      timeLabel={timeLabel}
      onRetry={onRetry}
    />
  ) : (
    <div className="text-[11px] text-neutral-400">Received · {timeLabel}</div>
  );

  // For assistant messages with tool calls and sequence info, use interleaved rendering
  const toolCalls = message.toolCalls ?? [];
  const hasSequenceInfo = message.content.some((b) => b.acpSeq !== undefined) ||
    toolCalls.some((tc) => tc.acpSeq !== undefined);

  if (!isOwn && toolCalls.length > 0 && hasSequenceInfo) {
    return (
      <MessageWrapper
        isOwn={isOwn}
        footer={footer}
        messageId={message._id}
        messageKey={message.clientMessageId ?? message._id}
        messageRole={message.role}
      >
        <InterleavedAssistantContent
          content={message.content}
          toolCalls={toolCalls}
        />
      </MessageWrapper>
    );
  }

  return (
    <MessageWrapper
      isOwn={isOwn}
      footer={footer}
      messageId={message._id}
      messageKey={message.clientMessageId ?? message._id}
      messageRole={message.role}
    >
      <MessageContent blocks={message.content} renderMarkdown={!isOwn} />
    </MessageWrapper>
  );
}

type ToolCallWithSeq = NonNullable<Doc<"conversationMessages">["toolCalls"]>[number];
type ContentBlockWithSeq = Doc<"conversationMessages">["content"][number];

/**
 * Renders assistant content interleaved with tool calls based on acpSeq.
 * - First text segment appears above the tool calls
 * - Tool calls + intermediate text appear inline (chronologically interleaved)
 * - Final text segment appears below the tool calls
 */
function InterleavedAssistantContent({
  content,
  toolCalls,
}: {
  content: ContentBlockWithSeq[];
  toolCalls: ToolCallWithSeq[];
}) {
  // Separate content blocks: those without acpSeq go at the beginning
  const unsequencedBlocks = content.filter((b) => b.acpSeq === undefined);
  const sequencedBlocks = content.filter((b) => b.acpSeq !== undefined);

  // Merge and sort all sequenced items by sequence number
  type SequencedItem =
    | { kind: "content"; block: ContentBlockWithSeq; seq: number }
    | { kind: "tool"; toolCall: ToolCallWithSeq; seq: number };

  const items: SequencedItem[] = [];

  for (const block of sequencedBlocks) {
    items.push({ kind: "content", block, seq: block.acpSeq as number });
  }

  for (const tc of toolCalls) {
    if (tc.acpSeq !== undefined) {
      items.push({ kind: "tool", toolCall: tc, seq: tc.acpSeq });
    }
  }

  // Sort by sequence number
  items.sort((a, b) => a.seq - b.seq);

  // If no sequenced items, fall back to simple rendering
  if (items.length === 0) {
    return <MessageContent blocks={content} renderMarkdown />;
  }

  // Find first tool call index to split content
  const firstToolIndex = items.findIndex((item) => item.kind === "tool");
  // Find last tool index manually (findLastIndex may not be available in all targets)
  let lastToolIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "tool") {
      lastToolIndex = i;
      break;
    }
  }

  // If no tool calls, just render all content
  if (firstToolIndex === -1) {
    return <MessageContent blocks={content} renderMarkdown />;
  }

  // Split into segments
  const beforeTools = items.slice(0, firstToolIndex);
  const toolSection = items.slice(firstToolIndex, lastToolIndex + 1);
  const afterTools = items.slice(lastToolIndex + 1);

  // Extract content blocks from before section
  const beforeBlocks = beforeTools
    .filter((item): item is SequencedItem & { kind: "content" } => item.kind === "content")
    .map((item) => item.block);

  // Keep the middle section as interleaved items for chronological display
  const middleItems = toolSection;

  // Extract content blocks from after section
  const afterBlocks = afterTools
    .filter((item): item is SequencedItem & { kind: "content" } => item.kind === "content")
    .map((item) => item.block);

  // Combine unsequenced blocks with before blocks
  const allBeforeBlocks = [...unsequencedBlocks, ...beforeBlocks];

  return (
    <div className="space-y-2">
      {/* First text segment - unsequenced + before any tool calls */}
      {allBeforeBlocks.length > 0 && (
        <MessageContent blocks={allBeforeBlocks} renderMarkdown />
      )}

      {/* Tool calls + thinking - chronologically interleaved */}
      {middleItems.length > 0 && (
        <InterleavedInlineSection items={middleItems} />
      )}

      {/* Final text segment - after all tool calls */}
      {afterBlocks.length > 0 && (
        <MessageContent blocks={afterBlocks} renderMarkdown />
      )}
    </div>
  );
}

type InterleavedItem =
  | { kind: "content"; block: ContentBlockWithSeq; seq: number }
  | { kind: "tool"; toolCall: ToolCallWithSeq; seq: number };

/**
 * Inline section that renders tool calls and thinking in chronological order.
 */
function InterleavedInlineSection({ items }: { items: InterleavedItem[] }) {
  return (
    <div className="space-y-1 border-l border-neutral-200/70 pl-3 dark:border-neutral-800/70">
      {items.map((item, idx) =>
        item.kind === "tool" ? (
          <ToolCallDisplay
            key={item.toolCall.id}
            title={item.toolCall.name}
            detail={buildToolDetailFromArgs(item.toolCall.arguments)}
            status={item.toolCall.status}
            sections={[
              ...(item.toolCall.arguments
                ? [{ label: "Arguments", content: item.toolCall.arguments }]
                : []),
              ...(item.toolCall.result
                ? [{ label: "Result", content: item.toolCall.result }]
                : []),
            ]}
          />
        ) : (
          <div key={`thinking-${idx}`} className="py-1">
            <div className="text-[12px] text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
              <span className="mr-2 text-[11px] text-neutral-400">Thinking:</span>
              <span>{item.block.type === "text" ? item.block.text : ""}</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function MessageDeliveryStatus({
  status,
  error,
  timeLabel,
  onRetry,
}: {
  status?: "queued" | "sent" | "error";
  error?: string;
  timeLabel: string;
  onRetry?: () => void;
}) {
  const handleCopyError = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Error copied to clipboard");
    } catch (error) {
      console.error("Failed to copy error", error);
      toast.error("Failed to copy error");
    }
  };

  if (status === "queued") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {error ?? "Waiting for sandbox"} · {timeLabel}
      </div>
    );
  }

  if (status === "error") {
    const errorText = error ?? "Delivery failed";
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-3 rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-400">
          <span className="max-w-[360px] truncate">{errorText}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full border border-rose-400/40 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:border-rose-300 hover:text-rose-500 dark:text-rose-200 dark:hover:text-rose-100"
            >
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void handleCopyError(errorText);
            }}
            className="rounded-full border border-rose-400/40 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:border-rose-300 hover:text-rose-500 dark:text-rose-200 dark:hover:text-rose-100"
          >
            Copy
          </button>
        </div>
        <div className="text-[11px] text-neutral-400">
          Failed · {timeLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="text-[11px] text-neutral-400">
      Saved · {timeLabel}
    </div>
  );
}

function MessageContent({
  blocks,
  renderMarkdown,
  isStreaming,
}: {
  blocks: ContentBlock[];
  renderMarkdown: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <MessageBlock
          key={`${block.type}-${index}`}
          block={block}
          renderMarkdown={renderMarkdown}
          isStreaming={isStreaming}
        />
      ))}
    </div>
  );
}

function MessageBlock({
  block,
  renderMarkdown,
  isStreaming,
}: {
  block: ContentBlock;
  renderMarkdown: boolean;
  isStreaming?: boolean;
}) {
  if (block.type === "text") {
    if (renderMarkdown) {
      return (
        <Streamdown className="streamdown" mode={isStreaming ? "streaming" : "static"}>
          {block.text ?? ""}
        </Streamdown>
      );
    }

    return <p className="whitespace-pre-wrap text-sm">{block.text}</p>;
  }

  if (block.type === "image" && block.data && block.mimeType) {
    return (
      <img
        src={`data:${block.mimeType};base64,${block.data}`}
        alt={block.name ?? "Image"}
        className="max-h-[360px] rounded-xl border border-neutral-200/70 object-contain dark:border-neutral-800/70"
      />
    );
  }

  if (block.type === "resource_link" && block.uri) {
    const isImage = block.description?.startsWith("image/") ?? false;
    if (isImage) {
      return (
        <img
          src={block.uri}
          alt={block.name ?? "Attachment"}
          className="max-h-[360px] rounded-xl border border-neutral-200/70 object-contain dark:border-neutral-800/70"
        />
      );
    }

    return (
      <a
        href={block.uri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-full border border-neutral-200/70 px-3 py-2 text-xs text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800/70 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-neutral-100"
      >
        {block.name ?? block.title ?? "Attachment"}
      </a>
    );
  }

  if (block.type === "resource" && block.resource?.text) {
    return <p className="whitespace-pre-wrap text-sm">{block.resource.text}</p>;
  }

  return null;
}

function SubmissionTimingDisplay({
  submittedAt,
  error,
}: {
  submittedAt: number;
  error: string | null;
}) {
  const [elapsed, setElapsed] = useState(() => Date.now() - submittedAt);

  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - submittedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [submittedAt, error]);

  if (error) {
    return (
      <div className="py-2 text-[11px] text-rose-500">
        {error}
      </div>
    );
  }

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div className="py-2 text-[11px] text-neutral-400 tabular-nums">
      {seconds}s
    </div>
  );
}

function PermissionPrompt({
  request,
  busy,
  onSelect,
}: {
  request: PermissionRequest;
  busy: boolean;
  onSelect: (optionId: string) => void;
}) {
  return (
    <div className="border-t border-neutral-200/70 bg-neutral-50/90 px-6 py-4 text-sm text-neutral-700 dark:border-neutral-800/70 dark:bg-neutral-900/70 dark:text-neutral-200">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-semibold text-neutral-400">
          Permission required
        </div>
        <div className="font-medium text-neutral-900 dark:text-neutral-100">
          {request.title ?? "Tool request"}
        </div>
        {request.description ? (
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            {request.description}
          </div>
        ) : null}
        {request.command ? (
          <div className="rounded-xl border border-neutral-200/70 bg-white/70 px-3 py-2 font-mono text-xs text-neutral-700 dark:border-neutral-800/70 dark:bg-neutral-950/60 dark:text-neutral-200">
            {request.command}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {request.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              onClick={() => onSelect(option.optionId)}
              disabled={busy}
              className="rounded-full border border-neutral-200/70 px-3 py-1 text-[11px] font-semibold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800/70 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-neutral-100"
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type ToolCallDisplaySection = {
  label: string;
  content: string;
};

type ToolCallDisplayProps = {
  title: string;
  detail: string | null;
  status: string | null;
  sections: ToolCallDisplaySection[];
};

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  if (first === "{" || first === "[" || first === "\"") return true;
  if (first === "-" || (first >= "0" && first <= "9")) return true;
  return trimmed === "true" || trimmed === "false" || trimmed === "null";
}

function formatToolPayload(value: string): string {
  if (!looksLikeJson(value)) return value;
  const parsed = safeParseJson(value);
  if (parsed === null) return value;
  if (typeof parsed === "object") {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      console.error("Failed to stringify tool payload", error);
      return value;
    }
  }
  if (typeof parsed === "string") return parsed;
  return String(parsed);
}

function truncateInline(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function buildToolDetailFromArgs(rawArgs: string | null): string | null {
  if (!rawArgs) return null;
  if (!looksLikeJson(rawArgs)) return truncateInline(rawArgs);

  const parsed = safeParseJson(rawArgs);
  if (parsed === null) return truncateInline(rawArgs);
  if (typeof parsed === "string") return truncateInline(parsed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return truncateInline(String(parsed));
  }
  if (!isRecord(parsed)) return truncateInline(rawArgs);

  const filePath = getRecordString(parsed, "file_path")
    ?? getRecordString(parsed, "filepath")
    ?? getRecordString(parsed, "filePath");
  if (filePath) return `Read ${filePath}`;

  const url = getRecordString(parsed, "url");
  if (url) return url;

  const path = getRecordString(parsed, "path");
  const pattern = getRecordString(parsed, "pattern");
  const outputMode = getRecordString(parsed, "output_mode");
  if (path && pattern) {
    const parts = [path, pattern];
    if (outputMode) parts.push(outputMode);
    return parts.join(" · ");
  }
  if (path) return path;
  if (pattern) return pattern;

  const command = getRecordString(parsed, "command");
  if (command) return command;

  const description = getRecordString(parsed, "description");
  if (description) return truncateInline(description);

  const prompt = getRecordString(parsed, "prompt");
  if (prompt) return truncateInline(prompt);

  const query = getRecordString(parsed, "query") ?? getRecordString(parsed, "q");
  if (query) return truncateInline(query);

  const mode = getRecordString(parsed, "output_mode");
  if (mode) return `mode: ${mode}`;

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      return `${key}: ${truncateInline(value)}`;
    }
  }

  return truncateInline(rawArgs);
}

function ToolCallDisplay({
  title,
  detail,
  status,
  sections,
}: ToolCallDisplayProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const displaySections = sections
    .map((section) => ({
      ...section,
      content: formatToolPayload(section.content).trim(),
    }))
    .filter((section) => section.content.length > 0);
  const hasOutput = displaySections.length > 0;
  const maxLines = 6;
  const outputLines = hasOutput
    ? displaySections.map((section) => section.content).join("\n").split("\n")
    : [];
  const shouldTruncate = outputLines.length > maxLines;

  const statusValue = status ?? "pending";
  const statusDot =
    statusValue === "completed"
      ? "bg-emerald-400"
      : statusValue === "failed"
        ? "bg-rose-400"
        : "bg-amber-400 animate-pulse";

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={hasOutput ? () => setCollapsed((value) => !value) : undefined}
        className={clsx(
          "flex w-full items-start gap-2 text-left",
          hasOutput ? "cursor-pointer hover:opacity-80" : "cursor-default"
        )}
      >
        <span
          className={clsx("mt-1 h-2 w-2 rounded-full", statusDot)}
          title={statusValue}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12px] font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
            </span>
            {detail ? (
              <span className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {detail}
              </span>
            ) : null}
          </div>
        </div>
      </button>
      {hasOutput && !collapsed ? (
        <div className="ml-4 mt-1 pt-1 border-l pl-3 border-neutral-200/70 dark:border-neutral-800/70">
          <div className="max-h-56 overflow-auto space-y-2 rounded-lg border px-3 py-2 text-[11px] border-neutral-200/70 bg-neutral-50 text-neutral-600 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-200">
            {displaySections.map((section, index) => {
              const lines = section.content.split("\n");
              const sectionContent =
                shouldTruncate && !expanded
                  ? lines.slice(0, maxLines).join("\n")
                  : section.content;
              return (
                <div key={`${section.label}-${index}`} className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    {section.label}
                  </div>
                  <pre className="m-0 whitespace-pre-wrap break-words">
                    {sectionContent}
                  </pre>
                </div>
              );
            })}
          </div>
          {shouldTruncate ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-[11px] text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {expanded
                ? "Hide output"
                : `Show ${outputLines.length - maxLines} more lines`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolCallMessage({
  call,
}: {
  call: ToolCallEntry;
}) {
  const sections: ToolCallDisplaySection[] = [];
  if (call.command) {
    sections.push({ label: "Command", content: call.command });
  } else if (call.description) {
    sections.push({ label: "Description", content: call.description });
  }
  if (call.outputs.length > 0) {
    sections.push({
      label: "Output",
      content: call.outputs.join("\n\n"),
    });
  }

  return (
    <ToolCallDisplay
      title={call.toolName ?? call.title ?? "Tool call"}
      detail={call.command ?? call.description ?? null}
      status={call.status}
      sections={sections}
    />
  );
}

function ThinkingMessage({ message }: { message: Doc<"conversationMessages"> }) {
  const textContent = message.content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!textContent) return null;

  return (
    <div className="py-1">
      <div className="text-[12px] text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">
        <span className="mr-2 text-[11px] text-neutral-400">Thinking:</span>
        <span>{textContent}</span>
      </div>
    </div>
  );
}

function RawAcpEventsPanel({
  rawEvents,
  streamStatus,
}: {
  rawEvents: RawEventView[];
  streamStatus: AcpStreamStatus;
}) {
  const streamLabel =
    streamStatus === "live"
      ? "Live"
      : streamStatus === "connecting"
        ? "Connecting"
        : streamStatus === "error"
          ? "Stream error"
          : streamStatus === "fallback"
            ? "Convex fallback"
            : "Idle";
  const streamTone =
    streamStatus === "live"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : streamStatus === "connecting"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : streamStatus === "error"
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          : "bg-neutral-400/10 text-neutral-500 dark:text-neutral-400";

  const handleCopyAll = async () => {
    if (rawEvents.length === 0) return;
    try {
      const payload = rawEvents.map((event) => event.raw).join("\n");
      await navigator.clipboard.writeText(payload);
      toast.success("Raw events copied");
    } catch (error) {
      console.error("Failed to copy raw events", error);
      toast.error("Failed to copy raw events");
    }
  };

  return (
    <div className="flex w-full min-h-0 max-h-[40vh] flex-col overflow-hidden border-t border-neutral-200/70 bg-neutral-50/70 px-4 py-4 dark:border-neutral-800/70 dark:bg-neutral-900/40 lg:h-full lg:max-h-none lg:w-[360px] lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-neutral-400">
          <span>Raw ACP events</span>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              streamTone
            )}
          >
            {streamLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopyAll}
          disabled={rawEvents.length === 0}
          className="rounded-full border border-neutral-200/70 px-3 py-1 text-[10px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800/70 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
        >
          Copy all
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {rawEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200/70 px-4 py-6 text-xs text-neutral-400 dark:border-neutral-800/70 dark:text-neutral-500">
            No raw events yet.
          </div>
        ) : (
          <div className="space-y-3 font-mono text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {rawEvents.map((event) => (
              <div
                key={event._id}
                className="rounded-xl border border-neutral-200/70 bg-white/80 px-3 py-2 dark:border-neutral-800/70 dark:bg-neutral-950/60"
              >
                <div className="mb-1 text-[10px] text-neutral-400">
                  {event.seq} ·{" "}
                  {new Date(event.createdAt).toLocaleTimeString()}
                </div>
                <pre className="whitespace-pre-wrap break-words">
                  {event.raw}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("Failed to parse JSON", error);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromContent(value: unknown): string | null {
  if (!isRecord(value)) return null;
  // Don't trim - preserve whitespace for proper streaming concatenation
  // LLM tokens often have leading spaces like " the" " meaning" " of"
  if (typeof value.text === "string" && value.text.length > 0) {
    return value.text;
  }
  const nested = value.content;
  if (isRecord(nested) && typeof nested.text === "string") {
    return nested.text.length > 0 ? nested.text : null;
  }
  return null;
}

function appendUnique(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function mergeRawEvents(
  convexEvents: Doc<"acpRawEvents">[],
  streamEvents: RawEventView[]
): RawEventView[] {
  const merged = new Map<number, RawEventView>();
  for (const event of convexEvents) {
    merged.set(event.seq, {
      _id: event._id,
      seq: event.seq,
      raw: event.raw,
      createdAt: event.createdAt,
      source: "convex",
    });
  }
  for (const event of streamEvents) {
    if (!merged.has(event.seq)) {
      merged.set(event.seq, event);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.seq - a.seq);
}

type ParsedAcpEvent =
  | { type: "message_chunk"; text: string }
  | { type: "reasoning_chunk"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | {
      type: "tool_call_update";
      id: string;
      status: string;
      result: string | null;
    }
  | { type: "message_complete"; stopReason: string; content: string | null };

function parseAcpEvent(raw: string): ParsedAcpEvent | null {
  const value = safeParseJson(raw);
  if (!value || !isRecord(value)) {
    return null;
  }

  const result = value.result;
  if (isRecord(result)) {
    const stopReason =
      typeof result.stopReason === "string" ? result.stopReason : null;
    const contentText = extractTextFromResult(result);
    if (stopReason) {
      return {
        type: "message_complete",
        stopReason,
        content: contentText,
      };
    }
    if (contentText) {
      return { type: "message_chunk", text: contentText };
    }
  }

  if (value.type === "event_msg" && isRecord(value.payload)) {
    if (value.payload.type === "agent_message") {
      const message = value.payload.message;
      if (typeof message === "string") {
        return { type: "message_chunk", text: message };
      }
    }
  }

  const params = value.params;
  if (isRecord(params)) {
    const update = params.update;
    if (isRecord(update)) {
      const sessionUpdate =
        typeof update.sessionUpdate === "string" ? update.sessionUpdate : null;

      switch (sessionUpdate) {
        case "agent_message_chunk": {
          const text = extractTextFromContent(update.content);
          if (text) {
            return { type: "message_chunk", text };
          }
          break;
        }
        case "agent_thought_chunk": {
          const text = extractTextFromContent(update.content);
          if (text) {
            return { type: "reasoning_chunk", text };
          }
          break;
        }
        case "tool_call": {
          const toolCallId =
            typeof update.toolCallId === "string"
              ? update.toolCallId
              : typeof update.id === "string"
                ? update.id
                : null;
          if (!toolCallId) break;
          const name =
            typeof update.title === "string"
              ? update.title
              : typeof update.name === "string"
                ? update.name
                : "unknown";
          const rawInput = update.rawInput ?? update.input ?? null;
          const argumentsValue = rawInput ? JSON.stringify(rawInput) : "{}";
          return {
            type: "tool_call",
            id: toolCallId,
            name,
            arguments: argumentsValue,
          };
        }
        case "tool_call_update": {
          const toolCallId =
            typeof update.toolCallId === "string"
              ? update.toolCallId
              : typeof update.id === "string"
                ? update.id
                : null;
          if (!toolCallId) break;
          const status =
            typeof update.status === "string"
              ? update.status
              : isRecord(update.fields) && typeof update.fields.status === "string"
                ? update.fields.status
                : "unknown";
          const resultValue =
            typeof update.result === "string"
              ? update.result
              : isRecord(update.fields) && typeof update.fields.result === "string"
                ? update.fields.result
                : extractToolOutput(update);
          return {
            type: "tool_call_update",
            id: toolCallId,
            status,
            result: resultValue ?? null,
          };
        }
        default:
          break;
      }
    }

    const contentText = extractTextFromContent(params.content);
    if (contentText) {
      return { type: "message_chunk", text: contentText };
    }
    if (typeof params.text === "string") {
      return { type: "message_chunk", text: params.text };
    }
  }

  return null;
}

function extractTextFromResult(result: Record<string, unknown>): string | null {
  if (isRecord(result.content)) {
    const text = extractTextFromContent(result.content);
    if (text) {
      return text;
    }
  }
  // Don't trim - preserve whitespace for proper streaming concatenation
  if (typeof result.text === "string") {
    return result.text.length > 0 ? result.text : null;
  }
  return null;
}

function extractToolOutput(update: Record<string, unknown>): string | null {
  const meta = update._meta;
  if (isRecord(meta) && isRecord(meta.claudeCode)) {
    const toolResponse = meta.claudeCode.toolResponse;
    if (isRecord(toolResponse) && typeof toolResponse.stdout === "string") {
      const stdout = toolResponse.stdout.trim();
      return stdout.length > 0 ? stdout : null;
    }
  }

  const content = update.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (isRecord(item) && isRecord(item.content)) {
      const nested = extractTextFromContent(item.content);
      if (nested) return nested;
    }
    const direct = extractTextFromContent(item);
    if (direct) return direct;
  }
  return null;
}

function buildStreamingMessage(
  rawEvents: RawEventView[],
  lastAssistantSeq: number
): StreamingMessage | null {
  if (rawEvents.length === 0) return null;
  const ordered = [...rawEvents].sort((a, b) => a.seq - b.seq);

  // Track text before and after first tool call
  let preambleText = ""; // Text BEFORE first tool_call
  let preambleSeq = 0;
  let streamingText = ""; // Text AFTER first tool_call
  let activeCreatedAt = 0;
  let activeLastSeq = 0;
  let sawToolCall = false;

  for (const event of ordered) {
    const parsed = parseAcpEvent(event.raw);
    if (!parsed) continue;

    if (parsed.type === "message_complete") {
      preambleText = "";
      preambleSeq = 0;
      streamingText = "";
      activeCreatedAt = 0;
      activeLastSeq = 0;
      sawToolCall = false;
      continue;
    }

    if (parsed.type === "tool_call") {
      sawToolCall = true;
    }

    if (parsed.type === "message_chunk") {
      if (activeCreatedAt === 0) {
        activeCreatedAt = event.createdAt;
      }

      if (!sawToolCall) {
        // Haven't seen a tool call yet - this is preamble
        preambleText += parsed.text;
        preambleSeq = event.seq;
      } else {
        // Already saw tool calls - this is streaming text after
        streamingText += parsed.text;
      }
      activeLastSeq = event.seq;
    }
  }

  // Combine text - if we have both preamble and streaming, keep them separate
  const totalText = preambleText + streamingText;
  if (totalText.trim().length === 0) {
    return null;
  }
  if (activeLastSeq <= lastAssistantSeq) {
    return null;
  }

  // If we have preamble and tool calls, include preamble info for separate rendering
  const hasPreamble = preambleText.trim().length > 0 && sawToolCall;

  return {
    content: [{ type: "text", text: hasPreamble ? streamingText : totalText }],
    createdAt: activeCreatedAt || Date.now(),
    lastSeq: activeLastSeq,
    ...(hasPreamble ? { preamble: preambleText, preambleSeq } : {}),
  };
}
