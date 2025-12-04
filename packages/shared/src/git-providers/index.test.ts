import { describe, it, expect, beforeEach } from "vitest";
import {
  providerRegistry,
  GitProviderRegistry,
  githubProvider,
  type ParsedRepo,
} from "./index.js";

describe("GitProviderRegistry", () => {
  describe("parseRepoUrl", () => {
    it("parses GitHub HTTPS URLs", () => {
      const result = providerRegistry.parseRepoUrl(
        "https://github.com/owner/repo"
      );
      expect(result).toEqual({
        owner: "owner",
        name: "repo",
        fullName: "owner/repo",
        url: "https://github.com/owner/repo",
        gitUrl: "https://github.com/owner/repo.git",
        provider: "github",
      });
    });

    it("parses GitHub HTTPS URLs with .git suffix", () => {
      const result = providerRegistry.parseRepoUrl(
        "https://github.com/owner/repo.git"
      );
      expect(result).toEqual({
        owner: "owner",
        name: "repo",
        fullName: "owner/repo",
        url: "https://github.com/owner/repo",
        gitUrl: "https://github.com/owner/repo.git",
        provider: "github",
      });
    });

    it("parses GitHub SSH URLs", () => {
      const result = providerRegistry.parseRepoUrl(
        "git@github.com:owner/repo.git"
      );
      expect(result).toEqual({
        owner: "owner",
        name: "repo",
        fullName: "owner/repo",
        url: "https://github.com/owner/repo",
        gitUrl: "https://github.com/owner/repo.git",
        provider: "github",
      });
    });

    it("parses simple owner/repo format", () => {
      const result = providerRegistry.parseRepoUrl("owner/repo");
      expect(result).toEqual({
        owner: "owner",
        name: "repo",
        fullName: "owner/repo",
        url: "https://github.com/owner/repo",
        gitUrl: "https://github.com/owner/repo.git",
        provider: "github",
      });
    });

    it("returns null for invalid URLs", () => {
      expect(providerRegistry.parseRepoUrl("")).toBeNull();
      expect(providerRegistry.parseRepoUrl("not-a-url")).toBeNull();
      expect(
        providerRegistry.parseRepoUrl("https://example.com/something")
      ).toBeNull();
    });

    it("handles URLs with trailing slash", () => {
      const result = providerRegistry.parseRepoUrl(
        "https://github.com/owner/repo/"
      );
      expect(result?.fullName).toBe("owner/repo");
    });

    it("handles owner names with hyphens and underscores", () => {
      const result = providerRegistry.parseRepoUrl(
        "https://github.com/my-org_name/my-repo"
      );
      expect(result?.owner).toBe("my-org_name");
      expect(result?.name).toBe("my-repo");
    });
  });

  describe("get", () => {
    it("returns registered provider by id", () => {
      const provider = providerRegistry.get("github");
      expect(provider.id).toBe("github");
      expect(provider.displayName).toBe("GitHub");
    });

    it("throws for unregistered provider", () => {
      expect(() => providerRegistry.get("gitlab" as "github")).toThrow(
        /not registered/
      );
    });
  });

  describe("tryGet", () => {
    it("returns provider if registered", () => {
      const provider = providerRegistry.tryGet("github");
      expect(provider?.id).toBe("github");
    });

    it("returns undefined for unregistered provider", () => {
      const provider = providerRegistry.tryGet("gitlab" as "github");
      expect(provider).toBeUndefined();
    });
  });

  describe("has", () => {
    it("returns true for registered provider", () => {
      expect(providerRegistry.has("github")).toBe(true);
    });

    it("returns false for unregistered provider", () => {
      expect(providerRegistry.has("gitlab" as "github")).toBe(false);
    });
  });

  describe("detectProvider", () => {
    it("detects GitHub from URL", () => {
      expect(
        providerRegistry.detectProvider("https://github.com/owner/repo")
      ).toBe("github");
    });

    it("returns null for unknown URLs", () => {
      expect(
        providerRegistry.detectProvider("https://unknown.com/owner/repo")
      ).toBeNull();
    });
  });

  describe("getByDomain", () => {
    it("returns provider by domain", () => {
      const provider = providerRegistry.getByDomain("github.com");
      expect(provider?.id).toBe("github");
    });

    it("is case insensitive", () => {
      const provider = providerRegistry.getByDomain("GitHub.COM");
      expect(provider?.id).toBe("github");
    });

    it("returns undefined for unknown domain", () => {
      expect(providerRegistry.getByDomain("unknown.com")).toBeUndefined();
    });
  });

  describe("all and ids", () => {
    it("returns all registered providers", () => {
      const all = providerRegistry.all();
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all.some((p) => p.id === "github")).toBe(true);
    });

    it("returns all registered provider ids", () => {
      const ids = providerRegistry.ids();
      expect(ids).toContain("github");
    });
  });
});

describe("githubProvider", () => {
  describe("parseRepoUrl", () => {
    it("returns null for non-GitHub URLs when used directly", () => {
      // The simple format owner/repo is ambiguous and GitHub claims it
      // But explicit other-provider URLs should return null
      const result = githubProvider.parseRepoUrl(
        "https://gitlab.com/owner/repo"
      );
      expect(result).toBeNull();
    });
  });

  describe("buildRepoUrl", () => {
    it("builds correct GitHub URL", () => {
      expect(githubProvider.buildRepoUrl("owner", "repo")).toBe(
        "https://github.com/owner/repo"
      );
    });
  });

  describe("buildGitUrl", () => {
    it("builds correct git clone URL", () => {
      expect(githubProvider.buildGitUrl("owner", "repo")).toBe(
        "https://github.com/owner/repo.git"
      );
    });
  });

  describe("getWebhookEventType", () => {
    it("extracts event type from headers", () => {
      const eventType = githubProvider.getWebhookEventType({
        "x-github-event": "pull_request",
      });
      expect(eventType).toBe("pull_request");
    });

    it("returns null if header is missing", () => {
      const eventType = githubProvider.getWebhookEventType({});
      expect(eventType).toBeNull();
    });
  });

  describe("mapWebhookEvent", () => {
    it("maps pull_request event", () => {
      const payload = {
        action: "opened",
        installation: { id: 12345 },
        repository: {
          id: 67890,
          full_name: "owner/repo",
          name: "repo",
          owner: { login: "owner" },
        },
      };

      const event = githubProvider.mapWebhookEvent("pull_request", payload);

      expect(event).toEqual({
        type: "pull_request",
        action: "opened",
        provider: "github",
        installationId: 12345,
        repository: {
          id: 67890,
          fullName: "owner/repo",
          name: "repo",
          owner: "owner",
        },
        deliveryId: undefined,
        rawPayload: payload,
      });
    });

    it("maps push event", () => {
      const payload = {
        installation: { id: 12345 },
        repository: {
          id: 67890,
          full_name: "owner/repo",
          name: "repo",
          owner: { login: "owner" },
        },
      };

      const event = githubProvider.mapWebhookEvent("push", payload);

      expect(event?.type).toBe("push");
      expect(event?.action).toBeUndefined();
    });

    it("maps workflow_run event", () => {
      const event = githubProvider.mapWebhookEvent("workflow_run", {
        action: "completed",
        installation: { id: 123 },
      });

      expect(event?.type).toBe("workflow_run");
      expect(event?.action).toBe("completed");
    });

    it("returns null for unknown event types", () => {
      const event = githubProvider.mapWebhookEvent("unknown_event", {});
      expect(event).toBeNull();
    });
  });

  describe("verifyWebhookSignature", () => {
    it("rejects missing signature", async () => {
      const result = await githubProvider.verifyWebhookSignature(
        { headers: {}, body: "{}" },
        "secret"
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Missing");
    });

    it("rejects invalid signature format", async () => {
      const result = await githubProvider.verifyWebhookSignature(
        { headers: { "x-hub-signature-256": "invalid" }, body: "{}" },
        "secret"
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("format");
    });

    it("accepts valid signature", async () => {
      const secret = "test-secret";
      const body = '{"test":"data"}';

      // Generate valid signature
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const messageData = encoder.encode(body);

      const key = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await githubProvider.verifyWebhookSignature(
        {
          headers: { "x-hub-signature-256": `sha256=${signature}` },
          body,
        },
        secret
      );

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects invalid signature", async () => {
      const result = await githubProvider.verifyWebhookSignature(
        {
          headers: {
            "x-hub-signature-256":
              "sha256=0000000000000000000000000000000000000000000000000000000000000000",
          },
          body: '{"test":"data"}',
        },
        "secret"
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("mismatch");
    });
  });
});

describe("GitProviderRegistry isolation", () => {
  let isolated: GitProviderRegistry;

  beforeEach(() => {
    isolated = new GitProviderRegistry();
  });

  it("starts empty", () => {
    expect(isolated.all()).toHaveLength(0);
    expect(isolated.ids()).toHaveLength(0);
  });

  it("allows registering providers", () => {
    isolated.register(githubProvider);
    expect(isolated.has("github")).toBe(true);
  });

  it("prevents duplicate registration", () => {
    isolated.register(githubProvider);
    expect(() => isolated.register(githubProvider)).toThrow(/already registered/);
  });

  it("allows replacing providers", () => {
    isolated.register(githubProvider);

    const modified = {
      ...githubProvider,
      displayName: "Modified GitHub",
    };

    isolated.replace(modified);
    expect(isolated.get("github").displayName).toBe("Modified GitHub");
  });

  it("can be cleared", () => {
    isolated.register(githubProvider);
    isolated.clear();
    expect(isolated.all()).toHaveLength(0);
  });
});
