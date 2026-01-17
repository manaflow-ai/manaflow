import { WebShell } from "@/components/web-ui/WebShell";
import {
  ConversationsSidebar,
  type ConversationScope,
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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  scope: z.enum(["mine", "all"]).optional(),
});

type SearchParams = z.infer<typeof searchSchema>;

const DEFAULT_SCOPE: ConversationScope = "mine";
const PAGE_SIZE = 30;
const OPTIMISTIC_CONVERSATION_PREFIX = "optimistic-";

type OptimisticConversation = {
  id: string;
  providerId: string;
  modelId: string | null;
  cwd: string;
  latestMessageAt: number;
  state: "creating" | "ready";
};

export const Route = createFileRoute("/_layout/t/$teamSlugOrId")({
  component: ConversationsLayout,
  validateSearch: (search: Record<string, unknown>): SearchParams =>
    searchSchema.parse(search),
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const scope = search.scope ?? DEFAULT_SCOPE;
  const { results, status, loadMore } = usePaginatedQuery(
    api.conversations.listPagedWithLatest,
    { teamSlugOrId, scope },
    { initialNumItems: PAGE_SIZE }
  );

  const match = useMatch({
    from: "/_layout/t/$teamSlugOrId/$conversationId",
    shouldThrow: false,
  });
  const activeConversationId = match?.params.conversationId;

  const startConversation = useAction(api.acp.startConversation);
  const sendMessage = useAction(api.acp.sendMessage);
  const prewarmSandbox = useAction(api.acp.prewarmSandbox);
  const [isCreating, setIsCreating] = useState(false);
  const [optimisticConversations, setOptimisticConversations] = useState<
    OptimisticConversation[]
  >([]);

  const serverEntries = useMemo(() => {
    const base = results ?? [];
    return base.map((entry) => ({
      conversationId: entry.conversation._id,
      providerId: entry.conversation.providerId,
      modelId: entry.conversation.modelId ?? null,
      cwd: entry.conversation.cwd,
      title: entry.title,
      preview: entry.preview,
      unread: entry.unread,
      latestMessageAt: entry.latestMessageAt,
      isOptimistic: false,
    }));
  }, [results]);

  const entries = useMemo(() => {
    const optimisticEntries = optimisticConversations.map((entry) => ({
      conversationId: entry.id,
      providerId: entry.providerId,
      modelId: entry.modelId,
      cwd: entry.cwd,
      title: null, // Title will be generated after first message
      preview: {
        text: entry.state === "creating" ? "Creating conversation…" : null,
        kind: "empty" as const,
      },
      unread: false,
      latestMessageAt: entry.latestMessageAt,
      isOptimistic: true,
    }));

    const optimisticIds = new Set(
      optimisticEntries.map((entry) => entry.conversationId)
    );
    const merged = [
      ...optimisticEntries,
      ...serverEntries.filter((entry) => !optimisticIds.has(entry.conversationId)),
    ];

    return merged.sort((a, b) => b.latestMessageAt - a.latestMessageAt);
  }, [optimisticConversations, serverEntries]);

  useEffect(() => {
    setLastTeamSlugOrId(teamSlugOrId);
  }, [teamSlugOrId]);

  useEffect(() => {
    if (!results || optimisticConversations.length === 0) return;
    const serverIds = new Set(
      results.map((entry) => entry.conversation._id.toString())
    );
    setOptimisticConversations((current) => {
      if (current.length === 0) return current;
      const next = current.filter((entry) => !serverIds.has(entry.id));
      return next.length === current.length ? current : next;
    });
  }, [optimisticConversations.length, results]);

  const handleScopeChange = (next: ConversationScope) => {
    if (next === scope) return;
    void navigate({
      search: { scope: next },
    });
  };

  const handleNewConversation = async (initialPrompt?: string) => {
    const previousConversationId = activeConversationId;
    const optimisticId = `${OPTIMISTIC_CONVERSATION_PREFIX}${crypto.randomUUID()}`;
    const now = Date.now();
    setOptimisticConversations((current) => [
      {
        id: optimisticId,
        providerId: "claude",
        modelId: null,
        cwd: "/root",
        latestMessageAt: now,
        state: "creating",
      },
      ...current,
    ]);
    setIsCreating(true);
    void navigate({
      to: "/t/$teamSlugOrId/$conversationId",
      params: {
        teamSlugOrId,
        conversationId: optimisticId,
      },
    });
    try {
      const result = await startConversation({
        teamSlugOrId,
        providerId: "claude",
        cwd: "/root",
      });
      setOptimisticConversations((current) =>
        current.map((entry) =>
          entry.id === optimisticId
            ? {
                ...entry,
                id: result.conversationId,
                latestMessageAt: Date.now(),
                state: "ready",
              }
            : entry
        )
      );
      await navigate({
        to: "/t/$teamSlugOrId/$conversationId",
        params: {
          teamSlugOrId,
          conversationId: result.conversationId,
        },
        replace: true,
      });
      if (initialPrompt?.trim()) {
        try {
          await sendMessage({
            conversationId: result.conversationId,
            content: [{ type: "text", text: initialPrompt.trim() }],
          });
        } catch (error) {
          console.error("Failed to send initial prompt", error);
          toast.error("Failed to send initial prompt");
        }
      }
    } catch (error) {
      console.error("Failed to start conversation", error);
      toast.error("Failed to start conversation");
      setOptimisticConversations((current) =>
        current.filter((entry) => entry.id !== optimisticId)
      );
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
      setIsCreating(false);
    }
  };

  const handlePrewarm = () => {
    void prewarmSandbox({ teamSlugOrId }).catch((error) => {
      console.error("Failed to prewarm sandbox", error);
    });
  };

  const handleSubmitDraft = (prompt: string) => {
    void handleNewConversation(prompt);
  };

  return (
    <WebShell
      sidebar={
        <ConversationsSidebar
          teamSlugOrId={teamSlugOrId}
          scope={scope}
          onScopeChange={handleScopeChange}
          entries={entries}
          status={status}
          onLoadMore={loadMore}
          activeConversationId={activeConversationId}
          onNewConversation={() => handleNewConversation()}
          onSubmitDraft={handleSubmitDraft}
          onPrewarm={handlePrewarm}
          isCreating={isCreating}
        />
      }
    >
      <Outlet />
    </WebShell>
  );
}
