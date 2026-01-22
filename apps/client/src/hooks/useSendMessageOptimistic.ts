import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";

type ContentBlock = Doc<"conversationMessages">["content"][number];

type Preview = {
  text: string | null;
  kind: "text" | "image" | "resource" | "empty";
};

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string | undefined> = {
  claude: "claude-opus-4-5-20251101",
};

const OPTIMISTIC_CONVERSATION_PREFIX = "client-";

function buildPreviewFromContent(content: ContentBlock[]): Preview {
  for (const block of content) {
    if (block.type === "text" && block.text) {
      return { text: block.text, kind: "text" };
    }
    if (block.type === "image") {
      return { text: "Image", kind: "image" };
    }
    if (block.type === "resource_link") {
      const label = block.name ?? block.title ?? block.description ?? "Attachment";
      const mimeType = block.mimeType ?? block.description ?? "";
      const isImage =
        typeof mimeType === "string" && mimeType.startsWith("image/");
      return { text: label, kind: isImage ? "image" : "resource" };
    }
    if (block.type === "resource" && block.resource?.text) {
      return { text: block.resource.text, kind: "resource" };
    }
  }

  return { text: null, kind: "empty" };
}

function buildOptimisticConversationDoc(options: {
  conversationId: Id<"conversations">;
  teamSlugOrId: string;
  providerId: string;
  cwd: string;
  clientConversationId?: string | null;
  createdAt: number;
}): Doc<"conversations"> {
  const sessionId = `acp-${options.createdAt}-${Math.random().toString(36).slice(2)}`;
  return {
    _id: options.conversationId,
    _creationTime: options.createdAt,
    teamId: options.teamSlugOrId,
    userId: undefined,
    sessionId,
    clientConversationId: options.clientConversationId ?? undefined,
    providerId: options.providerId,
    modelId: DEFAULT_MODEL_BY_PROVIDER[options.providerId],
    cwd: options.cwd,
    permissionMode: "auto_allow_always",
    status: "active",
    stopReason: undefined,
    namespaceId: undefined,
    sandboxInstanceId: undefined,
    isolationMode: undefined,
    modes: undefined,
    agentInfo: undefined,
    acpSandboxId: undefined,
    initializedOnSandbox: false,
    lastMessageAt: options.createdAt,
    lastAssistantVisibleAt: undefined,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    title: undefined,
  };
}

function buildOptimisticMessage(options: {
  messageId: Id<"conversationMessages">;
  conversationId: Id<"conversations">;
  content: ContentBlock[];
  clientMessageId?: string;
  createdAt: number;
}): Doc<"conversationMessages"> {
  return {
    _id: options.messageId,
    _creationTime: options.createdAt,
    conversationId: options.conversationId,
    clientMessageId: options.clientMessageId,
    role: "user",
    deliveryStatus: "queued",
    deliveryError: undefined,
    deliverySwapAttempted: false,
    content: options.content,
    toolCalls: undefined,
    reasoning: undefined,
    acpSeq: undefined,
    createdAt: options.createdAt,
  };
}

function isConversationMatch(
  entry: {
    conversation: Doc<"conversations">;
  },
  conversationId: Id<"conversations">,
  clientConversationId?: string | null,
): boolean {
  if (entry.conversation._id === conversationId) return true;
  if (
    clientConversationId &&
    entry.conversation.clientConversationId === clientConversationId
  ) {
    return true;
  }
  return false;
}

export function useSendMessageOptimistic() {
  return useMutation(api.acp.sendMessageOptimistic).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const conversationId =
        args.conversationId ??
        ((args.clientConversationId
          ? `${OPTIMISTIC_CONVERSATION_PREFIX}${args.clientConversationId}`
          : crypto.randomUUID()) as Id<"conversations">);

      const preview = buildPreviewFromContent(args.content);
      const optimisticMessage = buildOptimisticMessage({
        messageId: crypto.randomUUID() as Id<"conversationMessages">,
        conversationId,
        content: args.content,
        clientMessageId: args.clientMessageId ?? undefined,
        createdAt: now,
      });

      // Update the unified fullConversation query (used by conversation page)
      for (const query of localStore.getAllQueries(
        api.conversations.getFullConversation,
      )) {
        if (query.value === undefined || query.value === null) continue;
        const queryArgs = query.args as {
          teamSlugOrId: string;
          conversationId: Id<"conversations">;
        };
        if (queryArgs.teamSlugOrId !== args.teamSlugOrId) continue;
        if (queryArgs.conversationId !== conversationId) continue;

        // Filter out any existing message with same id or clientMessageId
        const filtered = query.value.messages.filter((item) => {
          if (item._id === optimisticMessage._id) return false;
          if (
            optimisticMessage.clientMessageId &&
            item.clientMessageId === optimisticMessage.clientMessageId
          ) {
            return false;
          }
          return true;
        });

        // Messages are ordered desc (newest first), so prepend
        localStore.setQuery(
          api.conversations.getFullConversation,
          query.args,
          {
            ...query.value,
            messages: [optimisticMessage, ...filtered],
          },
        );
      }

      // Update paginated messages query (legacy, kept for compatibility)
      for (const query of localStore.getAllQueries(
        api.conversationMessages.listByConversationPaginated,
      )) {
        if (query.value === undefined) continue;
        const { paginationOpts, ...rest } = query.args as {
          paginationOpts: { cursor: string | null };
          teamSlugOrId: string;
          conversationId: string;
        };
        if (rest.teamSlugOrId !== args.teamSlugOrId) continue;
        if (rest.conversationId !== conversationId) continue;

        const filtered = query.value.page.filter((item) => {
          if (item._id === optimisticMessage._id) return false;
          if (
            optimisticMessage.clientMessageId &&
            item.clientMessageId === optimisticMessage.clientMessageId
          ) {
            return false;
          }
          return true;
        });

        if (paginationOpts.cursor === null) {
          localStore.setQuery(
            api.conversationMessages.listByConversationPaginated,
            query.args,
            {
              ...query.value,
              page: [optimisticMessage, ...filtered],
            },
          );
        } else if (filtered.length !== query.value.page.length) {
          localStore.setQuery(
            api.conversationMessages.listByConversationPaginated,
            query.args,
            {
              ...query.value,
              page: filtered,
            },
          );
        }
      }

      for (const query of localStore.getAllQueries(
        api.conversations.listPagedWithLatest,
      )) {
        if (query.value === undefined) continue;
        const { paginationOpts, ...rest } = query.args as {
          paginationOpts: { cursor: string | null };
          teamSlugOrId: string;
          scope: "mine" | "all";
          includeArchived?: boolean;
        };
        if (rest.teamSlugOrId !== args.teamSlugOrId) continue;

        const existing = query.value.page.find((entry) =>
          isConversationMatch(entry, conversationId, args.clientConversationId),
        );

        const detail =
          args.conversationId &&
          localStore.getQuery(api.conversations.getDetail, {
            teamSlugOrId: args.teamSlugOrId,
            conversationId: args.conversationId,
          });

        const baseConversation =
          existing?.conversation ??
          detail?.conversation ??
          (args.providerId && args.cwd
            ? buildOptimisticConversationDoc({
                conversationId,
                teamSlugOrId: args.teamSlugOrId,
                providerId: args.providerId,
                cwd: args.cwd,
                clientConversationId: args.clientConversationId ?? undefined,
                createdAt: now,
              })
            : null);

        if (!baseConversation) continue;

        const updatedConversation: Doc<"conversations"> = {
          ...baseConversation,
          lastMessageAt: now,
          updatedAt: now,
        };

        const entry = {
          conversation: updatedConversation,
          preview,
          unread: existing?.unread ?? false,
          lastReadAt: existing?.lastReadAt ?? null,
          latestMessageAt: now,
          title: existing?.title ?? updatedConversation.title ?? null,
        };

        const filtered = query.value.page.filter(
          (item) =>
            !isConversationMatch(
              item,
              conversationId,
              args.clientConversationId,
            ),
        );

        if (paginationOpts.cursor === null) {
          localStore.setQuery(api.conversations.listPagedWithLatest, query.args, {
            ...query.value,
            page: [entry, ...filtered],
          });
        } else if (filtered.length !== query.value.page.length) {
          localStore.setQuery(api.conversations.listPagedWithLatest, query.args, {
            ...query.value,
            page: filtered,
          });
        }
      }
    },
  );
}
