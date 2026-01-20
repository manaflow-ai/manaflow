import { WebShell } from "@/components/web-ui/WebShell";
import {
  ConversationsSidebar,
  type ProviderId,
  type ConversationFilterMode,
} from "@/components/web-ui/ConversationsSidebar";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { setLastTeamSlugOrId } from "@/lib/lastTeam";
import { stackClientApp } from "@/lib/stack";
import { api } from "@cmux/convex/api";
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatch,
} from "@tanstack/react-router";
import { useAction, usePaginatedQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSendMessageOptimistic } from "@/hooks/useSendMessageOptimistic";
const PAGE_SIZE = 30;
const OPTIMISTIC_CONVERSATION_PREFIX = "client-";

export const Route = createFileRoute("/_layout/t/$teamSlugOrId")({
  component: ConversationsLayout,
  beforeLoad: async ({ params, location }) => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw redirect({
        to: "/sign-in",
        search: {
          after_auth_return_to: location.pathname,
        },
      });
    }
    const { teamSlugOrId } = params;
    const teamMemberships = await convexQueryClient.convexClient.query(
      api.teams.listTeamMemberships
    );
    const teamMembership = teamMemberships.find((membership) => {
      const team = membership.team;
      const membershipTeamId = team?.teamId ?? membership.teamId;
      const membershipSlug = team?.slug;
      return (
        membershipSlug === teamSlugOrId || membershipTeamId === teamSlugOrId
      );
    });
    if (!teamMembership) {
      throw redirect({ to: "/team-picker" });
    }
  },
});

function ConversationsLayout() {
  const { teamSlugOrId } = Route.useParams();
  const navigate = Route.useNavigate();
  const scope = "mine" as const;
  const [filterMode, setFilterMode] =
    useState<ConversationFilterMode>("all");
  const activeQuery = usePaginatedQuery(
    api.conversations.listPagedWithLatest,
    {
      teamSlugOrId,
      scope,
    },
    { initialNumItems: PAGE_SIZE }
  );
  const archivedQuery = usePaginatedQuery(
    api.conversations.listPagedWithLatest,
    {
      teamSlugOrId,
      scope,
      includeArchived: true,
    },
    { initialNumItems: PAGE_SIZE }
  );

  const match = useMatch({
    from: "/_layout/t/$teamSlugOrId/$conversationId",
    shouldThrow: false,
  });
  const activeConversationId = match?.params.conversationId;

  const sendMessage = useSendMessageOptimistic();
  const startConversation = useAction(api.acp.startConversation);
  const prewarmSandbox = useAction(api.acp.prewarmSandbox);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderId>("claude");
  const latestStartRef = useRef(0);

  const entries = useMemo(() => {
    const base =
      filterMode === "archived"
        ? archivedQuery.results ?? []
        : activeQuery.results ?? [];
    return base
      .map((entry) => ({
        conversationId: entry.conversation._id,
        clientConversationId: entry.conversation.clientConversationId ?? null,
        providerId: entry.conversation.providerId,
        modelId: entry.conversation.modelId ?? null,
        cwd: entry.conversation.cwd,
        title: entry.title,
        pinned: entry.conversation.pinned ?? false,
        isArchived: entry.conversation.isArchived ?? false,
        preview: entry.preview,
        unread: entry.unread,
        latestMessageAt: entry.latestMessageAt,
        isOptimistic: entry.conversation._id.startsWith(
          OPTIMISTIC_CONVERSATION_PREFIX
        ),
      }))
      .sort((a, b) => {
        const pinnedDelta = Number(b.pinned) - Number(a.pinned);
        if (pinnedDelta !== 0) {
          return pinnedDelta;
        }
        return b.latestMessageAt - a.latestMessageAt;
      });
  }, [activeQuery.results, archivedQuery.results, filterMode]);

  const filteredEntries = useMemo(() => {
    if (filterMode === "archived") {
      return entries.filter((entry) => entry.isArchived);
    }
    if (filterMode === "unread") {
      return entries.filter((entry) => entry.unread);
    }
    return entries;
  }, [entries, filterMode]);

  const status =
    filterMode === "archived" ? archivedQuery.status : activeQuery.status;
  const loadMore =
    filterMode === "archived" ? archivedQuery.loadMore : activeQuery.loadMore;

  useEffect(() => {
    setLastTeamSlugOrId(teamSlugOrId);
  }, [teamSlugOrId]);


  const handleNewConversation = async (
    initialPrompt?: string,
    providerId: ProviderId = selectedProvider
  ) => {
    const previousConversationId = activeConversationId;
    latestStartRef.current += 1;
    const requestId = latestStartRef.current;
    const trimmedPrompt = initialPrompt?.trim() ?? "";
    const clientConversationId = crypto.randomUUID();
    const clientMessageId = trimmedPrompt ? crypto.randomUUID() : null;
    const optimisticCreatedAt = Date.now();
    try {
      if (!trimmedPrompt) {
        setIsCreating(true);
        const result = await startConversation({
          teamSlugOrId,
          providerId,
          cwd: "/root",
          clientConversationId,
        });
        if (latestStartRef.current !== requestId) {
          return;
        }
        await navigate({
          to: "/t/$teamSlugOrId/$conversationId",
          params: {
            teamSlugOrId,
            conversationId: result.conversationId,
          },
          replace: true,
        });
        return;
      }

      const optimisticConversationId = `${OPTIMISTIC_CONVERSATION_PREFIX}${clientConversationId}`;
      const sendPromise = sendMessage({
        teamSlugOrId,
        providerId,
        cwd: "/root",
        content: [{ type: "text", text: trimmedPrompt }],
        clientMessageId: clientMessageId ?? undefined,
        clientConversationId,
      });
      void navigate({
        to: "/t/$teamSlugOrId/$conversationId",
        params: {
          teamSlugOrId,
          conversationId: optimisticConversationId,
        },
        state: {
          optimisticText: trimmedPrompt,
          optimisticClientMessageId: clientMessageId,
          optimisticCreatedAt,
        },
        replace: true,
      });
      const result = await sendPromise;
      if (latestStartRef.current !== requestId) {
        return;
      }
      await navigate({
        to: "/t/$teamSlugOrId/$conversationId",
        params: {
          teamSlugOrId,
          conversationId: result.conversationId,
        },
        replace: true,
      });
    } catch (error) {
      if (latestStartRef.current !== requestId) {
        return;
      }
      console.error("Failed to start conversation", error);
      toast.error("Failed to start conversation");
      if (!trimmedPrompt) {
        setIsCreating(false);
      }
      if (previousConversationId) {
        void navigate({
          to: "/t/$teamSlugOrId/$conversationId",
          params: {
            teamSlugOrId,
            conversationId: previousConversationId,
          },
          replace: true,
        });
      } else {
        void navigate({
          to: "/t/$teamSlugOrId",
          params: { teamSlugOrId },
          replace: true,
        });
      }
    } finally {
      if (!trimmedPrompt) {
        setIsCreating(false);
      }
    }
  };

  const handlePrewarm = () => {
    void prewarmSandbox({ teamSlugOrId }).catch((error) => {
      console.error("Failed to prewarm sandbox", error);
    });
  };

  const handleSubmitDraft = (prompt: string, providerId: ProviderId) => {
    void handleNewConversation(prompt, providerId);
  };

  return (
    <WebShell
      sidebar={
        <ConversationsSidebar
          teamSlugOrId={teamSlugOrId}
          entries={filteredEntries}
          status={status}
          onLoadMore={loadMore}
          activeConversationId={activeConversationId}
          onNewConversation={(providerId) => handleNewConversation(undefined, providerId)}
          onSubmitDraft={handleSubmitDraft}
          onPrewarm={handlePrewarm}
          isCreating={isCreating}
          providerId={selectedProvider}
          onProviderChange={setSelectedProvider}
          filterMode={filterMode}
          onFilterChange={setFilterMode}
        />
      }
    >
      <Outlet />
    </WebShell>
  );
}
