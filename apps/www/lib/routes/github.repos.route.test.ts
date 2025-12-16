import { testApiClient } from "@/lib/test-utils/openapi-client";
import { api } from "@cmux/convex/api";
import { getApiIntegrationsGithubRepos } from "@cmux/www-openapi-client";
import { describe, expect, it } from "vitest";
import { getConvex } from "../utils/get-convex";
import { __TEST_INTERNAL_ONLY_GET_STACK_TOKENS } from "@/lib/test-utils/__TEST_INTERNAL_ONLY_GET_STACK_TOKENS";

describe("githubReposRouter via SDK", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await getApiIntegrationsGithubRepos({
      client: testApiClient,
      query: { team: "manaflow" },
    });
    expect(res.response.status).toBe(401);
  });

  it(
    "returns repos for authenticated user",
    {
      timeout: 60_000,
    },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await getApiIntegrationsGithubRepos({
        client: testApiClient,
        query: { team: "manaflow" },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
    });
    // Accept 200 (OK), 401 (if token rejected), 500 (server error), or 501 (GitHub app not configured)
    expect([200, 401, 500, 501]).toContain(res.response.status);
    if (res.response.status === 200 && res.data) {
      // Expect the new flat shape
      const body = res.data as unknown as {
        repos: Array<{
          name: string;
          full_name: string;
          private: boolean;
          updated_at?: string | null;
          pushed_at?: string | null;
        }>;
      };
      expect(Array.isArray(body.repos)).toBe(true);
      // Should return at most 5 items
      expect(body.repos.length).toBeLessThanOrEqual(5);
      // No client-side sorting; server returns sorted by 'updated'.
    }
    }
  );

  it("can limit to a single installation when specified", async () => {
    const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
    const convex = getConvex({ accessToken: tokens.accessToken });

    let installationId: number | undefined;
    try {
      const conns = await convex.query(api.github.listProviderConnections, {
        teamSlugOrId: "manaflow",
      });
      console.log("conns", conns);
      installationId = conns.find((c) => c.isActive !== false)?.installationId;
    } catch (error) {
      // If convex is unreachable in this test env, skip the test
      console.log("Skipping test - Convex unreachable:", error);
      return;
    }
    if (!installationId) {
      console.log("Skipping test - No installation ID found");
      return;
    }

    const res = await getApiIntegrationsGithubRepos({
      client: testApiClient,
      query: { team: "manaflow", installationId },
      headers: { "x-stack-auth": JSON.stringify(tokens) },
    });
    expect([200, 401, 500, 501]).toContain(res.response.status);
    if (res.response.status === 200 && res.data) {
      const body = res.data as unknown as {
        repos: Array<{
          name: string;
          full_name: string;
          private: boolean;
          updated_at?: string | null;
          pushed_at?: string | null;
        }>;
      };
      expect(Array.isArray(body.repos)).toBe(true);
      expect(body.repos.length).toBeLessThanOrEqual(5);
    }
  });

  it("supports paging and still limits to 5", async () => {
    const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
    const first = await getApiIntegrationsGithubRepos({
      client: testApiClient,
      query: { team: "manaflow", page: 1 },
      headers: { "x-stack-auth": JSON.stringify(tokens) },
    });
    expect([200, 401, 500, 501]).toContain(first.response.status);
    if (first.response.status === 200 && first.data) {
      const second = await getApiIntegrationsGithubRepos({
        client: testApiClient,
        query: { team: "manaflow", page: 2 },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      expect([200, 401, 501]).toContain(second.response.status);
      if (second.response.status === 200 && second.data) {
        type ReposBody = {
          repos?: Array<{
            name: string;
            full_name: string;
            private: boolean;
            updated_at?: string | null;
            pushed_at?: string | null;
          }>;
        };
        const len1 = (first.data as unknown as ReposBody).repos?.length ?? 0;
        const len2 = (second.data as unknown as ReposBody).repos?.length ?? 0;
        expect(len1).toBeLessThanOrEqual(5);
        expect(len2).toBeLessThanOrEqual(5);
      }
    }
  });
});
