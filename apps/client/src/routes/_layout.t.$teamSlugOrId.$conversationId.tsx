import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import {
  useAction,
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  ImagePlus,
  Loader2,
  Send,
} from "lucide-react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import clsx from "clsx";
import { Streamdown } from "streamdown";

const PAGE_SIZE = 40;
const RAW_EVENTS_PAGE_SIZE = 120;
const OPTIMISTIC_CONVERSATION_PREFIX = "optimistic-";
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

type PendingMessageStatus = "sending" | "queued" | "sent" | "error";

type PendingMessage = {
  localId: string;
  serverId?: Id<"conversationMessages">;
  text: string;
  attachments: PendingImage[];
  createdAt: number;
  status: PendingMessageStatus;
  error?: string;
};

function isDeliveryStatus(value: unknown): value is PendingMessageStatus {
  return (
    value === "queued" ||
    value === "sent" ||
    value === "error" ||
    value === "sending"
  );
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
  const isOptimisticConversation = conversationIdParam.startsWith(
    OPTIMISTIC_CONVERSATION_PREFIX
  );
  const conversationId = conversationIdSchema.parse(conversationIdParam);
  const detail = useQuery(
    api.conversations.getDetail,
    isOptimisticConversation
      ? "skip"
      : {
          teamSlugOrId,
          conversationId,
        }
  );

  const { results, status, loadMore } = usePaginatedQuery(
    api.conversationMessages.listByConversationPaginated,
    isOptimisticConversation ? "skip" : { teamSlugOrId, conversationId },
    { initialNumItems: PAGE_SIZE }
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

  const messages = useMemo(() => results ?? [], [results]);
  const rawEvents = useMemo(() => rawEventsResults ?? [], [rawEventsResults]);

  const markRead = useMutation(api.conversationReads.markRead);
  const sendMessage = useAction(api.acp.sendMessage);
  const retryMessage = useAction(api.acp.retryMessage);
  const sendRpc = useAction(api.acp.sendRpc);
  const updatePermissionMode = useMutation(
    api.conversations.updatePermissionMode
  );
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const convex = useConvex();

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PendingImage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [showRawEvents, setShowRawEvents] = useState(false);
  const [permissionInFlight, setPermissionInFlight] = useState<string | null>(
    null
  );
  const [dismissedPermissionIds, setDismissedPermissionIds] = useState<
    string[]
  >([]);
  const lastAutoPermissionId = useRef<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToBottom = useRef(false);
  const lastMarkedAt = useRef<number | null>(null);
  const attachmentsRef = useRef<PendingImage[]>([]);

  const conversation = detail?.conversation ?? null;
  const sandbox = detail?.sandbox ?? null;
  const effectivePermissionMode: PermissionMode =
    (conversation?.permissionMode as PermissionMode | undefined) ??
    "auto_allow_always";

  const latestMessageAt =
    messages[0]?.createdAt ?? conversation?.lastMessageAt ?? null;
  const isSending = pendingMessages.some(
    (pending) => pending.status === "sending"
  );

  useEffect(() => {
    if (isOptimisticConversation) return;
    if (!latestMessageAt) return;
    if (
      lastMarkedAt.current !== null &&
      latestMessageAt <= lastMarkedAt.current
    ) {
      return;
    }

    lastMarkedAt.current = latestMessageAt;
    void markRead({
      teamSlugOrId,
      conversationId,
      lastReadAt: latestMessageAt,
    }).catch((error) => {
      console.error("Failed to mark conversation read", error);
    });
  }, [conversationId, isOptimisticConversation, latestMessageAt, markRead, teamSlugOrId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [conversationId]);

  useEffect(() => {
    if (!shouldScrollToBottom.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
    shouldScrollToBottom.current = false;
  }, [messages.length]);

  useEffect(() => {
    if (isOptimisticConversation) return;
    const root = scrollRef.current;
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
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => {
        URL.revokeObjectURL(attachment.previewUrl);
      });
    };
  }, []);

  useEffect(() => {
    if (pendingMessages.length === 0) return;
    const serverIds = new Set(messages.map((message) => message._id));

    setPendingMessages((current) => {
      const next = current.filter((pending) => {
        if (!pending.serverId) return true;
        if (pending.status !== "sent") return true;
        return !serverIds.has(pending.serverId);
      });

      if (next.length !== current.length) {
        const removed = current.filter(
          (pending) =>
            pending.serverId &&
            pending.status === "sent" &&
            serverIds.has(pending.serverId)
        );
        removed.forEach((pending) => {
          pending.attachments.forEach((attachment) => {
            URL.revokeObjectURL(attachment.previewUrl);
          });
        });
      }

      return next;
    });
  }, [messages, pendingMessages.length]);

  useEffect(() => {
    if (pendingMessages.length === 0 || messages.length === 0) return;
    const byId = new Map(messages.map((message) => [message._id, message]));

    setPendingMessages((current) => {
      let changed = false;
      const next = current.map((pending): PendingMessage => {
        if (!pending.serverId) return pending;
        const message = byId.get(pending.serverId);
        if (!message?.deliveryStatus || !isDeliveryStatus(message.deliveryStatus)) {
          return pending;
        }
        if (message.deliveryStatus === "sent" && pending.status !== "sent") {
          changed = true;
          return { ...pending, status: "sent", error: undefined };
        }
        if (message.deliveryStatus === "error" && pending.status !== "error") {
          changed = true;
          return {
            ...pending,
            status: "error",
            error: message.deliveryError ?? pending.error ?? "Delivery failed",
          };
        }
        if (message.deliveryStatus === "queued" && pending.status === "sending") {
          changed = true;
          return { ...pending, status: "queued" };
        }
        return pending;
      });

      return changed ? next : current;
    });
  }, [messages, pendingMessages.length]);

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

  const handleSend = async () => {
    if (isOptimisticConversation) {
      toast.message("Conversation is still starting");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    const localId = crypto.randomUUID();
    const pending: PendingMessage = {
      localId,
      text: trimmed,
      attachments: [...attachments],
      createdAt: Date.now(),
      status: "sending",
    };

    setPendingMessages((current) => [pending, ...current]);
    setText("");
    setAttachments([]);

    await sendPendingMessage(pending);
  };

  const sendPendingMessage = async (pendingOrId: PendingMessage | string) => {
    const pending =
      typeof pendingOrId === "string"
        ? pendingMessages.find((entry) => entry.localId === pendingOrId)
        : pendingOrId;
    if (!pending) {
      return;
    }

    setPendingMessages((current) =>
      current.map((entry) =>
        entry.localId === pending.localId
          ? { ...entry, status: "sending", error: undefined }
          : entry
      )
    );

    try {
      if (pending.serverId) {
        const result = await retryMessage({
          conversationId,
          messageId: pending.serverId,
        });
        if (result.status === "sent") {
          setPendingMessages((current) =>
            current.map((entry) =>
              entry.localId === pending.localId
                ? { ...entry, status: "sent" }
                : entry
            )
          );
        } else {
          setPendingMessages((current) =>
            current.map((entry) =>
              entry.localId === pending.localId
                ? {
                    ...entry,
                    status: "error",
                    error: result.error ?? "Delivery failed",
                  }
                : entry
            )
          );
        }
        return;
      }

      const uploaded = await Promise.all(
        pending.attachments.map(async (attachment) => {
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
        description?: string;
      }> = [];

      if (pending.text) {
        content.push({ type: "text", text: pending.text });
      }

      uploaded.forEach((item) => {
        content.push({
          type: "resource_link",
          uri: item.url,
          name: item.name,
          description: item.mimeType,
        });
      });

      const result = await sendMessage({
        conversationId,
        content,
      });

      if (result.status === "sent") {
        setPendingMessages((current) =>
          current.map((entry) =>
            entry.localId === pending.localId
              ? { ...entry, status: "sent", serverId: result.messageId }
              : entry
          )
        );
      } else if (result.status === "queued") {
        setPendingMessages((current) =>
          current.map((entry) =>
            entry.localId === pending.localId
              ? {
                  ...entry,
                  status: "queued",
                  serverId: result.messageId,
                  error: result.error ?? "Waiting for sandbox",
                }
              : entry
          )
        );
      } else {
        const errorMessage = result.error
          ? `Saved · ${result.error}`
          : "Message saved but delivery failed";
        setPendingMessages((current) =>
          current.map((entry) =>
            entry.localId === pending.localId
              ? {
                  ...entry,
                  status: "error",
                  serverId: result.messageId,
                  error: errorMessage,
                }
              : entry
          )
        );
      }
    } catch (error) {
      console.error("Failed to send message", error);
      setPendingMessages((current) =>
        current.map((entry) =>
          entry.localId === pending.localId
            ? { ...entry, status: "error", error: "Failed to send message" }
            : entry
        )
      );
      toast.error("Failed to send message");
    }
  };

  const pendingByServerId = useMemo(() => {
    const map = new Map<Id<"conversationMessages">, PendingMessage>();
    pendingMessages.forEach((pending) => {
      if (pending.serverId) {
        map.set(pending.serverId, pending);
      }
    });
    return map;
  }, [pendingMessages]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => !pendingByServerId.has(message._id)),
    [messages, pendingByServerId]
  );

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

  const combinedItems = useMemo(() => {
    const pendingItems = pendingMessages.map((pending) => ({
      kind: "pending" as const,
      createdAt: pending.createdAt,
      sortSeq: null as number | null,
      pending,
    }));
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

    return [...pendingItems, ...serverItems, ...toolItems].sort((a, b) => {
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
  }, [pendingMessages, toolCalls, visibleMessages]);

  const latestUserMessageAt = useMemo(() => {
    const serverUser = visibleMessages
      .filter(
        (message) =>
          message.role === "user" && message.deliveryStatus !== "error"
      )
      .map((message) => message.createdAt);
    const pendingUser = pendingMessages
      .filter((pending) => pending.status !== "error")
      .map((pending) => pending.createdAt);
    const all = [...serverUser, ...pendingUser];
    if (all.length === 0) return null;
    return Math.max(...all);
  }, [pendingMessages, visibleMessages]);

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
    : isOptimisticConversation
      ? {
          status: "starting",
          sandboxUrl: null,
          lastActivityAt: Date.now(),
        }
      : null;

  return (
    <div className="flex h-dvh min-h-dvh flex-1 flex-col overflow-hidden">
      <ConversationHeader
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

      <div className="flex flex-1 min-h-0 flex-col overflow-hidden lg:flex-row">
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="flex flex-col-reverse gap-4">
              {combinedItems.map((item) =>
                item.kind === "pending" ? (
                  <PendingConversationMessage
                    key={item.pending.localId}
                    pending={item.pending}
                    onRetry={() => sendPendingMessage(item.pending.localId)}
                  />
                ) : item.kind === "server" ? (
                  <ConversationMessage
                    key={item.message._id}
                    message={item.message}
                    isOwn={item.message.role === "user"}
                  />
                ) : (
                  <ToolCallMessage key={item.toolCall.id} call={item.toolCall} />
                )
              )}
              <div ref={loadMoreRef} />
              {status === "LoadingMore" ? (
                <div className="flex items-center justify-center py-4 text-xs text-neutral-400">
                  Loading older messages…
                </div>
              ) : null}
            </div>
          </div>

          {activePermissionRequest && effectivePermissionMode === "manual" ? (
            <PermissionPrompt
              request={activePermissionRequest}
              busy={
                permissionInFlight === activePermissionRequest.id.toString()
              }
              onSelect={handlePermissionDecision}
            />
          ) : null}

          <ConversationComposer
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
                ? "Creating conversation…"
                : isAwaitingResponse
                  ? "Waiting for agent response…"
                  : null
            }
          />
        </div>

        {showRawEvents ? (
          <RawAcpEventsPanel
            rawEvents={rawEvents}
            status={rawEventsStatus}
            onLoadMore={() => loadMoreRawEvents(RAW_EVENTS_PAGE_SIZE)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ConversationHeader({
  providerName,
  cwd,
  modelLabel,
  sandbox,
  showRawEvents,
  onToggleRawEvents,
  permissionMode,
  onPermissionModeChange,
}: {
  providerName: string;
  cwd: string;
  modelLabel: string;
  sandbox: SandboxMeta | null;
  showRawEvents: boolean;
  onToggleRawEvents: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}) {
  const status = sandbox?.status ?? "offline";
  const statusLabel = sandbox ? `Sandbox ${status}` : "Sandbox offline";

  return (
    <div className="border-b border-neutral-200/70 bg-white/80 px-6 py-4 dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-neutral-400 dark:text-neutral-500">
            {providerName}
          </div>
          <div className="mt-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {cwd}
          </div>
          <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            Model: {modelLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-full border border-neutral-200/70 bg-white/80 p-1 text-[10px] font-semibold text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-950/60 dark:text-neutral-400">
            {([
              { value: "auto_allow_always", label: "Auto" },
              { value: "manual", label: "Ask" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPermissionModeChange(option.value)}
                className={clsx(
                  "rounded-full px-3 py-1 transition",
                  permissionMode === option.value
                    ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-950"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onToggleRawEvents}
            className={clsx(
              "rounded-full border px-3 py-1 text-[10px] font-semibold transition",
              showRawEvents
                ? "border-neutral-900 bg-neutral-900 text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950"
                : "border-neutral-200/70 text-neutral-400 hover:border-neutral-300 hover:text-neutral-700 dark:border-neutral-800/70 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
            )}
            aria-pressed={showRawEvents}
          >
            Raw events
          </button>
          <div
            className="flex items-center gap-2 text-xs text-neutral-400"
            title={statusLabel}
          >
            <SandboxStatusIcon status={status} />
            <span>{status}</span>
          </div>
        </div>
      </div>
    </div>
  );
}


function SandboxStatusIcon({ status }: { status: ConversationSandboxStatus }) {
  switch (status) {
    case "running":
      return <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden />;
    case "paused":
      return <CircleSlash className="h-4 w-4 text-amber-500" aria-hidden />;
    case "stopped":
      return <CircleAlert className="h-4 w-4 text-neutral-400" aria-hidden />;
    case "offline":
      return <CircleAlert className="h-4 w-4 text-neutral-400" aria-hidden />;
    case "error":
      return <CircleAlert className="h-4 w-4 text-rose-500" aria-hidden />;
    case "starting":
    default:
      return <CircleDashed className="h-4 w-4 text-neutral-400" aria-hidden />;
  }
}

function ConversationMessage({
  message,
  isOwn,
}: {
  message: Doc<"conversationMessages">;
  isOwn: boolean;
}) {
  const timeLabel = formatDistanceToNow(new Date(message.createdAt), {
    addSuffix: true,
  });

  return (
    <div
      className={clsx(
        "flex flex-col gap-2",
        isOwn ? "items-end" : "items-start"
      )}
    >
      <div
        className={clsx(
          "max-w-[680px] rounded-2xl px-4 py-3 text-sm leading-relaxed",
        isOwn
          ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-950"
          : "bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100"
        )}
      >
        <MessageContent blocks={message.content} renderMarkdown={!isOwn} />
      </div>
      <div className="text-[11px] text-neutral-400">
        {isOwn ? "Saved" : "Received"} · {timeLabel}
      </div>
    </div>
  );
}

function PendingConversationMessage({
  pending,
  onRetry,
}: {
  pending: PendingMessage;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="max-w-[680px] rounded-2xl bg-neutral-900 px-4 py-3 text-sm leading-relaxed text-neutral-50 dark:bg-neutral-100 dark:text-neutral-950">
        {pending.text ? (
          <p className="whitespace-pre-wrap text-sm">{pending.text}</p>
        ) : null}
        {pending.attachments.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {pending.attachments.map((attachment) => (
              <img
                key={attachment.id}
                src={attachment.previewUrl}
                alt={attachment.file.name}
                className="h-28 w-full rounded-xl border border-neutral-200/20 object-cover"
              />
            ))}
          </div>
        ) : null}
      </div>
      <PendingMessageStatus pending={pending} onRetry={onRetry} />
    </div>
  );
}

function PendingMessageStatus({
  pending,
  onRetry,
}: {
  pending: PendingMessage;
  onRetry: () => void;
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

  if (pending.status === "sending") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Sending…
      </div>
    );
  }

  if (pending.status === "queued") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {pending.error ?? "Waiting for sandbox"}
      </div>
    );
  }

  if (pending.status === "sent") {
    return (
      <div className="text-[11px] text-neutral-400">
        Delivered
      </div>
    );
  }

  const errorText = pending.error ?? "Delivery failed";

  return (
    <div className="flex items-center gap-3 rounded-full border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-400">
      <span className="max-w-[360px] truncate">{errorText}</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-rose-400/40 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:border-rose-300 hover:text-rose-500 dark:text-rose-200 dark:hover:text-rose-100"
      >
        Retry
      </button>
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

function ConversationComposer({
  text,
  setText,
  attachments,
  setAttachments,
  onAttachFiles,
  onSend,
  isSending,
  isLocked,
  autoFocusKey,
  statusMessage,
}: {
  text: string;
  setText: (value: string) => void;
  attachments: PendingImage[];
  setAttachments: Dispatch<SetStateAction<PendingImage[]>>;
  onAttachFiles: (files: FileList | null) => void;
  onSend: () => void;
  isSending: boolean;
  isLocked: boolean;
  autoFocusKey: string;
  statusMessage: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!textAreaRef.current) return;
    const handle = requestAnimationFrame(() => {
      textAreaRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [autoFocusKey]);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    textArea.style.height = "0px";
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [text]);

  const canSend =
    !isLocked &&
    !isSending &&
    (text.trim().length > 0 || attachments.length > 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isComposingRef.current) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => {
        if (attachment.id === id) {
          URL.revokeObjectURL(attachment.previewUrl);
          return false;
        }
        return true;
      });
      return next;
    });
  };

  return (
    <div className="border-t border-neutral-200/70 bg-white/80 px-6 py-4 dark:border-neutral-800/70 dark:bg-neutral-950/80">
      {statusMessage ? (
        <div className="mb-2 text-[11px] text-neutral-400">
          {statusMessage}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative h-20 w-20 overflow-hidden rounded-xl border border-neutral-200/70 dark:border-neutral-800/70"
            >
              <img
                src={attachment.previewUrl}
                alt={attachment.file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => handleRemoveAttachment(attachment.id)}
                className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                x
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200/70 bg-white text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800 dark:border-neutral-800/70 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:text-neutral-100"
          disabled={isLocked}
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex-1">
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            rows={1}
            placeholder="write a message · enter to send"
            className={clsx(
              "w-full resize-none rounded-2xl border border-neutral-200/80 bg-white/80 px-4 py-3 text-sm text-neutral-900",
              "focus:border-neutral-400 focus:outline-none dark:border-neutral-800/80 dark:bg-neutral-900/70 dark:text-neutral-100",
              "max-h-40 overflow-y-auto"
            )}
          />
        </div>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="send message"
          className={clsx(
            "flex h-10 items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 text-neutral-50 transition",
            "hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-neutral-200"
          )}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          <span className="text-[11px] font-semibold">send</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onAttachFiles(event.target.files);
          if (event.currentTarget) {
            event.currentTarget.value = "";
          }
        }}
      />
    </div>
  );
}

function ToolCallMessage({ call }: { call: ToolCallEntry }) {
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
        <span className={clsx("mt-1 h-2 w-2 rounded-full", statusDot)} />
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
        <span className="text-[10px] font-semibold text-neutral-400">
          {status}
        </span>
      </button>
      {hasOutput && !collapsed ? (
        <div className="ml-4 mt-1 pt-1 border-l border-neutral-200/70 pl-3 dark:border-neutral-800/70">
          <pre className="m-0 max-h-36 overflow-auto rounded-lg border border-neutral-200/70 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-200">
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
  onLoadMore,
}: {
  rawEvents: Doc<"acpRawEvents">[];
  status: PaginatedStatus;
  onLoadMore: () => void;
}) {
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
        <div className="text-[11px] font-semibold text-neutral-400">
          Raw ACP events
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
  } catch {
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
