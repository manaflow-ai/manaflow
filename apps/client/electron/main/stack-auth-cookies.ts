export type StackCookieSameSite =
  | "unspecified"
  | "no_restriction"
  | "lax"
  | "strict";

export type StackAuthCookieSpec = {
  name: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: StackCookieSameSite;
  path: string;
  /** Seconds from now (not an absolute timestamp). */
  maxAgeSeconds: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getStackAuthRefreshBaseName(projectId: string): string {
  return `stack-refresh-${projectId}`;
}

export function getStackAuthRefreshDefaultCookieName(
  projectId: string,
  secure: boolean
): string {
  // Matches Stack Auth SDK: `${secure ? "__Host-" : ""}stack-refresh-${projectId}--default`
  return `${secure ? "__Host-" : ""}${getStackAuthRefreshBaseName(projectId)}--default`;
}

export function formatStackAuthStructuredRefreshCookieValue(
  refreshToken: string,
  updatedAtMillis: number
): string {
  // Matches Stack Auth SDK shape: { refresh_token, updated_at_millis }.
  return JSON.stringify({
    refresh_token: refreshToken,
    updated_at_millis: updatedAtMillis,
  });
}

export function parseStackAuthStructuredRefreshCookieValue(value: string): {
  refreshToken: string;
  updatedAtMillis: number | null;
} | null {
  if (!value.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const refreshToken = parsed.refresh_token;
    const updatedAtMillis = parsed.updated_at_millis;
    if (typeof refreshToken !== "string") return null;
    if (
      updatedAtMillis !== undefined &&
      updatedAtMillis !== null &&
      typeof updatedAtMillis !== "number"
    ) {
      return null;
    }
    return {
      refreshToken,
      updatedAtMillis: typeof updatedAtMillis === "number" ? updatedAtMillis : null,
    };
  } catch {
    return null;
  }
}

function parseStackAccessParam(
  value: string
): { accessToken: string | null; refreshToken: string | null } {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) {
    return { refreshToken: null, accessToken: trimmed || null };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length < 2) {
      return { refreshToken: null, accessToken: null };
    }
    const refreshToken = parsed[0];
    const accessToken = parsed[1];
    return {
      refreshToken: typeof refreshToken === "string" ? refreshToken : null,
      accessToken: typeof accessToken === "string" ? accessToken : null,
    };
  } catch {
    return { refreshToken: null, accessToken: null };
  }
}

export function buildStackAuthAccessCookieValue(
  refreshToken: string,
  stackAccessParam: string
): { accessCookieValue: string; accessToken: string } {
  const parsed = parseStackAccessParam(stackAccessParam);
  const accessToken = parsed.accessToken ?? stackAccessParam.trim();
  return {
    // Stack Auth SDK expects JSON.stringify([refreshToken, accessToken]).
    accessCookieValue: JSON.stringify([refreshToken, accessToken]),
    accessToken,
  };
}

function isStackCookieName(name: string, baseName: string): boolean {
  return (
    name === baseName ||
    name === `__Host-${baseName}` ||
    name === `__Secure-${baseName}` ||
    name.startsWith(`${baseName}--`) ||
    name.startsWith(`__Host-${baseName}--`) ||
    name.startsWith(`__Secure-${baseName}--`)
  );
}

export function isStackAuthCookieName(
  name: string,
  projectId: string
): boolean {
  if (name === "stack-is-https") return true;
  if (isStackCookieName(name, "stack-access")) return true;

  const refreshBase = getStackAuthRefreshBaseName(projectId);
  if (isStackCookieName(name, refreshBase)) return true;
  if (isStackCookieName(name, "stack-refresh")) return true;

  return false;
}

export function buildStackAuthCookieSpecs(options: {
  projectId: string;
  refreshToken: string;
  stackAccessParam: string;
  secure: boolean;
}): { refresh: StackAuthCookieSpec; access: StackAuthCookieSpec; isHttps: StackAuthCookieSpec } {
  const { projectId, refreshToken, stackAccessParam, secure } = options;
  const nowMillis = Date.now();
  const refreshCookieName = getStackAuthRefreshDefaultCookieName(projectId, secure);
  const refreshCookieValue = formatStackAuthStructuredRefreshCookieValue(
    refreshToken,
    nowMillis
  );
  const { accessCookieValue } = buildStackAuthAccessCookieValue(
    refreshToken,
    stackAccessParam
  );

  // Mirror Stack Auth SDK defaults:
  // - refresh cookie maxAge: 1 year
  // - access cookie maxAge: 1 day
  // - sameSite: Lax (unless partitioned cookies; Electron cookie API doesn't expose CHIPS easily)
  const refreshMaxAgeSeconds = 60 * 60 * 24 * 365;
  const accessMaxAgeSeconds = 60 * 60 * 24;

  return {
    refresh: {
      name: refreshCookieName,
      value: refreshCookieValue,
      secure,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAgeSeconds: refreshMaxAgeSeconds,
    },
    access: {
      name: "stack-access",
      value: accessCookieValue,
      secure,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAgeSeconds: accessMaxAgeSeconds,
    },
    isHttps: {
      name: "stack-is-https",
      value: "true",
      secure,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAgeSeconds: refreshMaxAgeSeconds,
    },
  };
}

