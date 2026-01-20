import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  useAction,
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import type { SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const PAGE_SIZE = 40;
const RAW_EVENTS_PAGE_SIZE = 120;
const OPTIMISTIC_CONVERSATION_PREFIX = "client-";
const optimisticStateSchema = z.object({
  optimisticText: z.string().nullable().optional(),
  optimisticClientMessageId: z.string().nullable().optional(),
  optimisticCreatedAt: z.number().optional(),
});
const conversationIdSchema = z.custom<Id<"conversations">>(
  (value) => typeof value === "string"
);
const storageIdSchema = z.custom<Id<"_storage">>(
  (value) => typeof value === "string"
);
const uploadResponseSchema = z.object({ storageId: storageIdSchema });

export const Route = createFileRoute(
  "/_layout/t/$teamSlugOrId/$conversationId"
)({
  component: ConversationThread,
});

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


type PaginatedStatus = ReturnType<typeof usePaginatedQuery>["status"];

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

type ConversationSandboxStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "offline"
  | "error";

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
  const optimisticState = useMemo(() => {
    const parsed = optimisticStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);
  const optimisticText = optimisticState?.optimisticText?.trim() ?? "";
  const optimisticClientMessageId =
    optimisticState?.optimisticClientMessageId ?? null;
  const optimisticCreatedAt = optimisticState?.optimisticCreatedAt ?? Date.now();
  const detail = useQuery(
    api.conversations.getDetail,
    isOptimisticConversation
      ? "skip"
      : {
          teamSlugOrId,
          conversationId,
        }
  );
  const streamInfo = useQuery(
    api.acp.getStreamInfo,
    isOptimisticConversation
      ? "skip"
      : {
          teamSlugOrId,
          conversationId,
        }
  );

  const { results, status, loadMore } = usePaginatedQuery(
    api.conversationMessages.listByConversationPaginated,
    { teamSlugOrId, conversationId },
    { initialNumItems: PAGE_SIZE }
  );
  const firstPageMessages = useQuery(
    api.conversationMessages.listByConversationFirstPage,
    isOptimisticConversation
      ? "skip"
      : { teamSlugOrId, conversationId, numItems: PAGE_SIZE }
  );
  const {
    results: rawEventsResults,
    status: rawEventsStatus,
    loadMore: loadMoreRawEvents,
  } = usePaginatedQuery(
    api.acpRawEvents.listByConversationPaginated,
    isOptimisticConversation ? "skip" : { teamSlugOrId, conversationId },
    { initialNumItems: RAW_EVENTS_PAGE_SIZE }
  );
  const firstPageRawEvents = useQuery(
    api.acpRawEvents.listByConversationFirstPage,
    isOptimisticConversation
      ? "skip"
      : { teamSlugOrId, conversationId, numItems: RAW_EVENTS_PAGE_SIZE }
  );

  const optimisticMessage = useMemo(() => {
    if (!isOptimisticConversation || !optimisticText) return null;
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
      createdAt: optimisticCreatedAt,
    } satisfies Doc<"conversationMessages">;
  }, [
    conversationId,
    isOptimisticConversation,
    optimisticClientMessageId,
    optimisticCreatedAt,
    optimisticText,
  ]);
  const messages = useMemo(() => {
    if (results !== undefined) {
      return results;
    }
    if (firstPageMessages && firstPageMessages.page) {
      return firstPageMessages.page;
    }
    return [];
  }, [firstPageMessages, results]);
  const convexRawEvents = useMemo(() => {
    if (rawEventsResults !== undefined) {
      return rawEventsResults;
    }
    if (firstPageRawEvents && firstPageRawEvents.page) {
      return firstPageRawEvents.page;
    }
    return [];
  }, [firstPageRawEvents, rawEventsResults]);
  const latestConvexSeq = useMemo(() => {
    if (convexRawEvents.length === 0) return 0;
    return convexRawEvents.reduce(
      (max, event) => (event.seq > max ? event.seq : max),
      0
    );
  }, [convexRawEvents]);
  const stream = useAcpSandboxStream({
    enabled: true,
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

  const conversation = detail?.conversation ?? null;
  const sandbox = detail?.sandbox ?? null;
  const effectivePermissionMode: PermissionMode =
    (conversation?.permissionMode as PermissionMode | undefined) ??
    "auto_allow_always";

  const conversationKey = conversation?.clientConversationId ?? conversationIdParam;

  const [draftsByConversation, setDraftsByConversation] = useState<
    Map<string, DraftState>
  >(() => new Map());
  const draftsRef = useRef<Map<string, DraftState>>(new Map());
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [isSending, setIsSending] = useState(false);
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


  useEffect(() => {
    if (isOptimisticConversation) return;
    const root = scrollContainerRef.current;
    const target = loadMoreRef.current;
    if (!root || !target) return;
    if (status !== "CanLoadMore") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore(PAGE_SIZE);
        }
      },
      { root, threshold: 0.1 }
    );

    observer.observe(target);

    return () => {
      observer.unobserve(target);
    };
  }, [isOptimisticConversation, loadMore, status]);

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

  const visibleMessages = useMemo(() => {
    if (!isOptimisticConversation) {
      return messages;
    }
    if (!optimisticMessage) {
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
  }, [isOptimisticConversation, messages, optimisticMessage]);

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
    const streamItems = streamingMessage
      ? [
          {
            kind: "stream" as const,
            createdAt: streamingMessage.createdAt,
            sortSeq: streamingMessage.lastSeq,
            message: streamingMessage,
          },
        ]
      : [];
    const serverItems = visibleMessages.map((message) => ({
      kind: "server" as const,
      createdAt: message.createdAt,
      sortSeq: typeof message.acpSeq === "number" ? message.acpSeq : null,
      message,
    }));
    const toolItems = toolCalls.map((toolCall) => ({
      kind: "tool" as const,
      createdAt: toolCall.firstSeenAt,
      sortSeq: toolCall.firstSeenSeq,
      toolCall,
    }));

    return [...streamItems, ...serverItems, ...toolItems].sort((a, b) => {
      if (a.sortSeq !== null && b.sortSeq !== null) {
        if (a.sortSeq !== b.sortSeq) return b.sortSeq - a.sortSeq;
      }
      const byCreatedAt = b.createdAt - a.createdAt;
      if (byCreatedAt !== 0) return byCreatedAt;
      const aSeq = a.sortSeq ?? 0;
      const bSeq = b.sortSeq ?? 0;
      if (aSeq !== bSeq) return bSeq - aSeq;
      return 0;
    });
  }, [streamingMessage, toolCalls, visibleMessages]);

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

  const messagesContent = (
    <>
      {combinedItems.map((item) =>
        item.kind === "stream" ? (
          <StreamingConversationMessage
            key={`stream-${item.message.lastSeq}`}
            message={item.message}
          />
        ) : item.kind === "server" ? (
          <ConversationMessage
            key={item.message._id}
            message={item.message}
            isOwn={item.message.role === "user"}
            onRetry={
              item.message.role === "user" &&
              item.message.deliveryStatus === "error"
                ? () => handleRetryMessage(item.message._id)
                : undefined
            }
          />
        ) : (
          <ToolCallMessage key={item.toolCall.id} call={item.toolCall} />
        )
      )}
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
      statusMessage={
        isOptimisticConversation
          ? "Creating conversation..."
          : isAwaitingResponse
            ? "Waiting for agent response..."
            : null
      }
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
          isLoadingMore={status === "LoadingMore"}
          scrollToBottomKey={conversationIdParam}
          shouldScrollToBottom={messages.length > 0}
        />
      </div>

      {showRawEvents ? (
        <RawAcpEventsPanel
          rawEvents={rawEvents}
          status={rawEventsStatus}
          streamStatus={stream.status}
          onLoadMore={() => loadMoreRawEvents(RAW_EVENTS_PAGE_SIZE)}
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
      <MessageContent blocks={message.content} renderMarkdown />
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

  return (
    <MessageWrapper isOwn={isOwn} footer={footer}>
      <MessageContent blocks={message.content} renderMarkdown={!isOwn} />
    </MessageWrapper>
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
}: {
  blocks: ContentBlock[];
  renderMarkdown: boolean;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <MessageBlock
          key={`${block.type}-${index}`}
          block={block}
          renderMarkdown={renderMarkdown}
        />
      ))}
    </div>
  );
}

function MessageBlock({
  block,
  renderMarkdown,
}: {
  block: ContentBlock;
  renderMarkdown: boolean;
}) {
  if (block.type === "text") {
    if (renderMarkdown) {
      return (
        <Streamdown className="streamdown">
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

function ToolCallMessage({
  call,
}: {
  call: ToolCallEntry;
}) {
  const status = call.status ?? "pending";
  const [collapsed, setCollapsed] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const outputs = call.outputs.join("\n\n").trim();
  const hasOutput = outputs.length > 0;
  const maxLines = 6;
  const outputLines = hasOutput ? outputs.split("\n") : [];
  const shouldTruncate = outputLines.length > maxLines;
  const displayOutput =
    shouldTruncate && !expanded
      ? outputLines.slice(0, maxLines).join("\n")
      : outputs;
  const title = call.toolName ?? call.title ?? "Tool call";
  const detail = call.command ?? call.description ?? null;

  const statusDot =
    status === "completed"
      ? "bg-emerald-400"
      : status === "failed"
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
          title={status}
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
          <pre className="m-0 max-h-36 overflow-auto rounded-lg border px-3 py-2 text-[11px] border-neutral-200/70 bg-neutral-50 text-neutral-600 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-200">
            {displayOutput}
          </pre>
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

function RawAcpEventsPanel({
  rawEvents,
  status,
  streamStatus,
  onLoadMore,
}: {
  rawEvents: RawEventView[];
  status: PaginatedStatus;
  streamStatus: AcpStreamStatus;
  onLoadMore: () => void;
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAll}
            disabled={rawEvents.length === 0}
            className="rounded-full border border-neutral-200/70 px-3 py-1 text-[10px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800/70 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
          >
            Copy all
          </button>
          {status === "CanLoadMore" ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="rounded-full border border-neutral-200/70 px-3 py-1 text-[10px] font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800 dark:border-neutral-800/70 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
            >
              Load more
            </button>
          ) : null}
        </div>
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
        {status === "LoadingMore" ? (
          <div className="mt-3 text-xs text-neutral-400">Loading…</div>
        ) : null}
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
  if (typeof value.text === "string" && value.text.trim().length > 0) {
    return value.text.trim();
  }
  const nested = value.content;
  if (isRecord(nested) && typeof nested.text === "string") {
    const text = nested.text.trim();
    return text.length > 0 ? text : null;
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
  if (typeof result.text === "string") {
    const trimmed = result.text.trim();
    return trimmed.length > 0 ? trimmed : null;
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
  let activeText = "";
  let activeCreatedAt = 0;
  let activeLastSeq = 0;

  for (const event of ordered) {
    const parsed = parseAcpEvent(event.raw);
    if (!parsed) continue;

    if (parsed.type === "message_complete") {
      activeText = "";
      activeCreatedAt = 0;
      activeLastSeq = 0;
      continue;
    }

    if (parsed.type === "message_chunk") {
      if (activeCreatedAt === 0) {
        activeCreatedAt = event.createdAt;
      }
      activeText += parsed.text;
      activeLastSeq = event.seq;
    }
  }

  if (activeText.trim().length === 0) {
    return null;
  }
  if (activeLastSeq <= lastAssistantSeq) {
    return null;
  }

  return {
    content: [{ type: "text", text: activeText }],
    createdAt: activeCreatedAt || Date.now(),
    lastSeq: activeLastSeq,
  };
}
