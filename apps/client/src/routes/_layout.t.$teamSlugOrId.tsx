import { WebShell } from "@/components/web-ui/WebShell";
import {
  ConversationsSidebar,
  type ConversationScope,
  type ProviderId,
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
  clientConversationId: string;
  providerId: string;
  modelId: string | null;
  cwd: string;
  latestMessageAt: number;
  state: "creating" | "ready";
  draftText?: string | null;
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
  const prewarmSandbox = useAction(api.acp.prewarmSandbox);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderId>("claude");
  const [optimisticConversations, setOptimisticConversations] = useState<
    OptimisticConversation[]
  >([]);

  const serverEntries = useMemo(() => {
    const base = results ?? [];
    return base.map((entry) => ({
      conversationId: entry.conversation._id,
      clientConversationId: entry.conversation.clientConversationId ?? null,
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
      clientConversationId: entry.clientConversationId,
      providerId: entry.providerId,
      modelId: entry.modelId,
      cwd: entry.cwd,
      title: null, // Title will be generated after first message
      preview: {
        text:
          entry.draftText?.trim() ??
          (entry.state === "creating" ? "Creating conversation…" : null),
        kind: entry.draftText?.trim() ? ("text" as const) : ("empty" as const),
      },
      unread: false,
      latestMessageAt: entry.latestMessageAt,
      isOptimistic: true,
    }));

    const optimisticIds = new Set(
      optimisticEntries.map((entry) => entry.conversationId)
    );
    const optimisticClientIds = new Set(
      optimisticEntries
        .map((entry) => entry.clientConversationId)
        .filter((value): value is string => Boolean(value))
    );
    const merged = [
      ...optimisticEntries,
      ...serverEntries.filter((entry) => {
        if (optimisticIds.has(entry.conversationId)) return false;
        if (
          entry.clientConversationId &&
          optimisticClientIds.has(entry.clientConversationId)
        ) {
          return false;
        }
        return true;
      }),
    ];

    const deduped = new Map<string, (typeof merged)[number]>();
    for (const entry of merged) {
      const existing = deduped.get(entry.conversationId);
      if (!existing) {
        deduped.set(entry.conversationId, entry);
        continue;
      }
      if (entry.latestMessageAt > existing.latestMessageAt) {
        deduped.set(entry.conversationId, entry);
        continue;
      }
      if (
        entry.latestMessageAt === existing.latestMessageAt &&
        entry.unread &&
        !existing.unread
      ) {
        deduped.set(entry.conversationId, entry);
      }
    }

    return Array.from(deduped.values()).sort(
      (a, b) => b.latestMessageAt - a.latestMessageAt
    );
  }, [optimisticConversations, serverEntries]);

  useEffect(() => {
    setLastTeamSlugOrId(teamSlugOrId);
  }, [teamSlugOrId]);

  useEffect(() => {
    if (!results || optimisticConversations.length === 0) return;
    const serverById = new Map(
      results.map((entry) => [entry.conversation._id.toString(), entry] as const)
    );
    setOptimisticConversations((current) => {
      if (current.length === 0) return current;
      const next = current.filter((entry) => {
        const serverEntry = serverById.get(entry.id);
        if (!serverEntry) return true;
        const hasDraft = Boolean(entry.draftText?.trim());
        if (hasDraft && serverEntry.preview.kind === "empty") {
          return true;
        }
        return false;
      });
      return next.length === current.length ? current : next;
    });
  }, [optimisticConversations.length, results]);

  const handleScopeChange = (next: ConversationScope) => {
    if (next === scope) return;
    void navigate({
      search: { scope: next },
    });
  };

  const handleNewConversation = async (
    initialPrompt?: string,
    providerId: ProviderId = selectedProvider
  ) => {
    const previousConversationId = activeConversationId;
    const clientConversationId = crypto.randomUUID();
    const optimisticId = `${OPTIMISTIC_CONVERSATION_PREFIX}${clientConversationId}`;
    const now = Date.now();
    const trimmedPrompt = initialPrompt?.trim() ?? null;
    setOptimisticConversations((current) => [
      {
        id: optimisticId,
        clientConversationId,
        providerId,
        modelId: null,
        cwd: "/root",
        latestMessageAt: now,
        state: "creating",
        draftText: trimmedPrompt,
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
        providerId,
        cwd: "/root",
        clientConversationId,
      });
      setOptimisticConversations((current) =>
        current.map((entry) =>
          entry.id === optimisticId
              ? {
                  ...entry,
                  id: result.conversationId,
                  clientConversationId,
                  latestMessageAt: Date.now(),
                  state: "ready",
                  draftText: trimmedPrompt,
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
        state: {
          initialPrompt: trimmedPrompt,
          clientMessageId: trimmedPrompt ? crypto.randomUUID() : null,
        },
      });
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

  const handleSubmitDraft = (prompt: string, providerId: ProviderId) => {
    void handleNewConversation(prompt, providerId);
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
          onNewConversation={(providerId) => handleNewConversation(undefined, providerId)}
          onSubmitDraft={handleSubmitDraft}
          onPrewarm={handlePrewarm}
          isCreating={isCreating}
          providerId={selectedProvider}
          onProviderChange={setSelectedProvider}
        />
      }
    >
      <Outlet />
    </WebShell>
  );
}
