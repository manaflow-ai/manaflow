import { base64urlFromBytes, base64urlToBytes } from "./encoding";

export type InstallationAccountInfo = {
  accountLogin: string;
  accountId?: number;
  accountType?: "Organization" | "User";
};

export type NormalizedInstallationRepo = {
  fullName: string;
  org: string;
  name: string;
  gitRemote: string;
  providerRepoId?: number;
  ownerLogin?: string;
  ownerType?: "Organization" | "User";
  visibility?: "public" | "private";
  defaultBranch?: string;
  lastPushedAt?: number;
};

const textEncoder = new TextEncoder();
const privateKeyCache = new Map<string, CryptoKey>();

function pemToDer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const base64Url = cleaned
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return base64urlToBytes(base64Url);
}

function base64urlEncodeJson(value: unknown): string {
  return base64urlFromBytes(textEncoder.encode(JSON.stringify(value)));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cached = privateKeyCache.get(pem);
  if (cached) return cached;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is not available in this environment");
  }
  const der = pemToDer(pem);
  const keyData =
    der.byteOffset === 0 && der.byteLength === der.buffer.byteLength
      ? der
      : der.slice();
  const key = await subtle.importKey(
    "pkcs8",
    keyData as BufferSource,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
  privateKeyCache.set(pem, key);
  return key;
}

export async function createGithubAppJwt(
  appId: string,
  privateKey: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" } as const;
  const payload = {
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  } as const;
  const signingInput = `${base64urlEncodeJson(header)}.${base64urlEncodeJson(
    payload
  )}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SubtleCrypto is not available in this environment");
  }
  const key = await importPrivateKey(privateKey);
  const signature = await subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    textEncoder.encode(signingInput)
  );
  const signaturePart = base64urlFromBytes(new Uint8Array(signature));
  return `${signingInput}.${signaturePart}`;
}

function normalizeAccountType(
  input: unknown
): InstallationAccountInfo["accountType"] {
  return input === "Organization" || input === "User" ? input : undefined;
}

export async function fetchInstallationAccountInfo(
  installationId: number,
  appId: string,
  privateKey: string
): Promise<InstallationAccountInfo | null> {
  if (!appId || !privateKey) {
    return null;
  }

  try {
    const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
    const jwt = await createGithubAppJwt(appId, normalizedPrivateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "xagi-github-setup",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[github_app] Failed to fetch installation ${installationId} info (status ${response.status}): ${errorText}`
      );
      return null;
    }

    const data = (await response.json()) as {
      account?: {
        login?: string | null;
        id?: number | null;
        type?: string | null;
      };
    };

    const login = data.account?.login ?? undefined;
    if (!login) {
      return null;
    }

    return {
      accountLogin: login,
      accountId:
        typeof data.account?.id === "number" ? data.account?.id : undefined,
      accountType: normalizeAccountType(data.account?.type ?? undefined),
    };
  } catch (error) {
    console.error(
      `[github_app] Unexpected error fetching installation ${installationId} info`,
      error
    );
    return null;
  }
}

type InstallationRepository = {
  id?: number;
  name?: string | null;
  full_name?: string | null;
  private?: boolean | null;
  default_branch?: string | null;
  pushed_at?: string | null;
  clone_url?: string | null;
  owner?: {
    login?: string | null;
    type?: string | null;
  } | null;
};

function parseTimestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function fetchInstallationAccessToken(
  installationId: number,
  appId: string,
  privateKey: string
): Promise<string | null> {
  if (!appId || !privateKey) {
    return null;
  }

  try {
    const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
    const jwt = await createGithubAppJwt(appId, normalizedPrivateKey);
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "xagi-github-setup",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[github_app] Failed to mint access token for installation ${installationId} (status ${response.status}): ${errorText}`
      );
      return null;
    }

    const data = (await response.json()) as { token?: string | null };
    if (!data.token) {
      console.warn(
        `[github_app] No access token returned for installation ${installationId}`
      );
      return null;
    }
    return data.token;
  } catch (error) {
    console.error(
      `[github_app] Unexpected error minting access token for installation ${installationId}`,
      error
    );
    return null;
  }
}

function normalizeInstallationRepo(
  repo: InstallationRepository
): NormalizedInstallationRepo | null {
  const fullName = repo.full_name ?? undefined;
  const name = repo.name ?? undefined;
  if (!fullName || !name) {
    return null;
  }

  const ownerLogin = repo.owner?.login ?? undefined;
  const ownerTypeRaw = repo.owner?.type ?? undefined;
  const ownerType =
    ownerTypeRaw === "Organization" || ownerTypeRaw === "User"
      ? ownerTypeRaw
      : undefined;
  const org = ownerLogin ?? fullName.split("/")[0] ?? fullName;
  const visibility =
    repo.private === undefined || repo.private === null
      ? undefined
      : repo.private
        ? "private"
        : "public";

  return {
    fullName,
    name,
    org,
    gitRemote: repo.clone_url ?? `https://github.com/${fullName}.git`,
    providerRepoId: typeof repo.id === "number" ? repo.id : undefined,
    ownerLogin,
    ownerType,
    visibility,
    defaultBranch: repo.default_branch ?? undefined,
    lastPushedAt: parseTimestamp(repo.pushed_at ?? undefined),
  };
}

export async function* iterateInstallationRepositories(
  installationId: number,
  appId: string,
  privateKey: string,
  options?: { perPage?: number }
): AsyncGenerator<NormalizedInstallationRepo[], void, void> {
  const accessToken = await fetchInstallationAccessToken(
    installationId,
    appId,
    privateKey
  );
  if (!accessToken) {
    return;
  }

  const perPage = Math.max(1, Math.min(options?.perPage ?? 100, 100));
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xagi-github-setup",
  } as const;

  let page = 1;
  for (;;) {
    try {
      const response = await fetch(
        `https://api.github.com/installation/repositories?per_page=${perPage}&page=${page}`,
        { headers }
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[github_app] Failed to list repositories for installation ${installationId} (status ${response.status}): ${errorText}`
        );
        break;
      }

      const data = (await response.json()) as {
        repositories?: InstallationRepository[];
      };
      const repos = data.repositories ?? [];
      const normalized = repos
        .map(normalizeInstallationRepo)
        .filter((repo): repo is NormalizedInstallationRepo => repo !== null);
      if (normalized.length > 0) {
        yield normalized;
      }

      if (repos.length < perPage) {
        break;
      }
      page += 1;
    } catch (error) {
      console.error(
        `[github_app] Unexpected error listing repositories for installation ${installationId}`,
        error
      );
      break;
    }
  }
}

export async function fetchAllInstallationRepositories(
  installationId: number,
  appId: string,
  privateKey: string,
  options?: { perPage?: number }
): Promise<NormalizedInstallationRepo[]> {
  const results: NormalizedInstallationRepo[] = [];
  for await (const page of iterateInstallationRepositories(
    installationId,
    appId,
    privateKey,
    options
  )) {
    results.push(...page);
  }
  return results;
}
