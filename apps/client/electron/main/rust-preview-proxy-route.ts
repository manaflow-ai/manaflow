const CMUX_DOMAINS = [
  "cmux.app",
  "cmux.sh",
  "cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "autobuild.app",
] as const;

const DIRECT_MORPH_REGEX = /^port-(\d+)-morphvm-([^.]+)(\..+?)$/i;

export const DEFAULT_MORPH_DOMAIN_SUFFIX = ".http.cloud.morph.so";

export interface ProxyRoute {
  morphId: string;
  scope: string;
  domainSuffix: string;
  morphDomainSuffix?: string;
}

function normalizeMorphDomainSuffix(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_MORPH_DOMAIN_SUFFIX;
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function resolveMorphDomainSuffix(
  override?: string | null
): string | undefined {
  if (override === null) {
    return undefined;
  }
  if (override && override.trim().length > 0) {
    return normalizeMorphDomainSuffix(override);
  }
  const envOverride = process.env.CMUX_MORPH_DOMAIN_SUFFIX;
  if (!envOverride || envOverride.trim().length === 0) {
    return undefined;
  }
  return normalizeMorphDomainSuffix(envOverride);
}

function parseMorphVmHost(
  hostname: string
): { morphId: string; port: string; suffix: string } | null {
  const match = hostname.match(DIRECT_MORPH_REGEX);
  if (!match) return null;
  const [, port, morphId, suffix] = match;
  if (!port || !morphId || !suffix) {
    return null;
  }
  return {
    morphId: morphId.toLowerCase(),
    port,
    suffix,
  };
}

export function deriveProxyRoute(
  url: string,
  options?: { morphDomainSuffix?: string | null }
): ProxyRoute | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    const morphVmHost = parseMorphVmHost(hostname);
    if (morphVmHost) {
      return {
        morphId: morphVmHost.morphId,
        scope: "base",
        domainSuffix: "cmux.app",
        morphDomainSuffix: normalizeMorphDomainSuffix(
          morphVmHost.suffix
        ),
      };
    }

    for (const domain of CMUX_DOMAINS) {
      const suffix = `.${domain}`;
      if (!hostname.endsWith(suffix)) {
        continue;
      }
      const subdomain = hostname.slice(0, -suffix.length);
      if (!subdomain.startsWith("cmux-")) {
        continue;
      }
      const remainder = subdomain.slice("cmux-".length);
      const segments = remainder
        .split("-")
        .filter((segment) => segment.length > 0);
      if (segments.length < 3) {
        continue;
      }
      const portSegment = segments.pop();
      const scopeSegment = segments.pop();
      if (!portSegment || !scopeSegment) {
        continue;
      }
      if (!/^\d+$/.test(portSegment)) {
        continue;
      }
      const morphId = segments.join("-");
      if (!morphId) {
        continue;
      }
      const morphSuffix = resolveMorphDomainSuffix(
        options?.morphDomainSuffix
      );
      return {
        morphId,
        scope: scopeSegment,
        domainSuffix: domain,
        ...(morphSuffix
          ? { morphDomainSuffix: morphSuffix }
          : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}
