import { describe, expect, it, vi } from "vitest";
import { syncMissingTeamFromStack } from "./team-verification";

describe("syncMissingTeamFromStack", () => {
  it("syncs a matching Stack team into Convex when the team row is missing", async () => {
    const mutation = vi.fn(async () => undefined);
    const loadUser = vi.fn(async () => ({
      id: "user_123",
      listTeams: async () => [
        {
          id: "team_123",
          displayName: "Personal Team",
          profileImageUrl: "https://example.com/team.png",
          clientMetadata: { slug: "personal-team-123" },
          clientReadOnlyMetadata: { readOnly: true },
          serverMetadata: { source: "stack" },
          createdAt: new Date("2026-03-20T00:00:00.000Z"),
        },
      ],
    }));
    const getAdminClient = vi.fn(
      () =>
        ({
          mutation,
        }) as never,
    );

    const synced = await syncMissingTeamFromStack({
      accessToken: "token-123",
      teamSlugOrId: "team_123",
      loadUser,
      getAdminClient,
    });

    expect(synced).toBe(true);
    expect(loadUser).toHaveBeenCalledWith({
      req: undefined,
      accessToken: "token-123",
    });
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        id: "team_123",
        displayName: "Personal Team",
        createdAtMillis: new Date("2026-03-20T00:00:00.000Z").getTime(),
      }),
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { teamId: "team_123", userId: "user_123" },
    );
  });

  it("returns false when the requested team is not in the user's Stack memberships", async () => {
    const mutation = vi.fn(async () => undefined);
    const synced = await syncMissingTeamFromStack({
      accessToken: "token-123",
      teamSlugOrId: "team_missing",
      loadUser: async () => ({
        id: "user_123",
        listTeams: async () => [
          {
            id: "team_123",
            createdAt: new Date("2026-03-20T00:00:00.000Z"),
          },
        ],
      }),
      getAdminClient: () =>
        ({
          mutation,
        }) as never,
    });

    expect(synced).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });
});
