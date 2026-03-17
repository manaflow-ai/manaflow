const DIRECT_MORPH_REGEX = /^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$/i;

const PROXY_DOMAINS = [
  "cmux.app",
  "cmux.sh",
  "cmux.dev",
  "manaflow.com",
  "cmux.local",
  "cmux.localhost",
  "autobuild.app",
  "vm.freestyle.sh",
] as const;

export type MorphInstanceSource =
  | "http-cloud"
  | "cmux-proxy"
  | "cmux-port";

export interface MorphInstanceInfo {
  hostname: string;
  morphId: string;
  instanceId: string;
  port: number | null;
  source: MorphInstanceSource;
}

function toInstanceId(morphId: string): string | null {
  const normalized = morphId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("morphvm_")) {
    return normalized;
  }

  if (normalized.startsWith("morphvm-")) {
    return `morphvm_${normalized.slice("morphvm-".length)}`;
  }

  return `morphvm_${normalized}`;
}

function parseDirectMorphHost(hostname: string): MorphInstanceInfo | null {
  const match = hostname.match(DIRECT_MORPH_REGEX);
  if (!match) {
    return null;
  }

  const portValue = match[1];
  const morphIdValue = match[2];
  if (!portValue || !morphIdValue) {
    return null;
  }

  const port = Number.parseInt(portValue, 10);
  const instanceId = toInstanceId(morphIdValue);
  if (Number.isNaN(port) || !instanceId) {
    return null;
  }

  return {
    hostname,
    morphId: morphIdValue.toLowerCase(),
    instanceId,
    port,
    source: "http-cloud",
  };
}

function parseCmuxProxyHost(hostname: string): MorphInstanceInfo | null {
  const normalized = hostname.toLowerCase();
  for (const domain of PROXY_DOMAINS) {
    const suffix = `.${domain}`;
    if (!normalized.endsWith(suffix)) {
      continue;
    }
    const subdomain = normalized.slice(0, -suffix.length);
    if (!subdomain) {
      continue;
    }

    if (subdomain.startsWith("manaflow-") || subdomain.startsWith("cmux-")) {
      const prefix = subdomain.startsWith("manaflow-") ? "manaflow-" : "cmux-";
      const remainder = subdomain.slice(prefix.length);
      const segments = remainder.split("-").filter((segment) => segment.length > 0);
      if (segments.length < 2) {
        return null;
      }

      const portSegment = segments[segments.length - 1];
      const rawMorphId = segments[0];
      if (!portSegment || !rawMorphId) {
        return null;
      }
      if (!/^\d+$/.test(portSegment)) {
        return null;
      }

      const morphId = rawMorphId.toLowerCase();
      const instanceId = toInstanceId(morphId);
      if (!instanceId) {
        return null;
      }

      const port = Number.parseInt(portSegment, 10);
      if (Number.isNaN(port)) {
        return null;
      }

      return {
        hostname,
        morphId,
        instanceId,
        port,
        source: "cmux-proxy",
      };
    }

    if (subdomain.startsWith("port-")) {
      const portMatch = subdomain.match(/^port-(\d+)-([a-z0-9-]+)$/);
      if (!portMatch) {
        continue;
      }

      const portValue = portMatch[1];
      const rawMorphId = portMatch[2];
      if (!portValue || !rawMorphId) {
        continue;
      }

      const port = Number.parseInt(portValue, 10);
      if (Number.isNaN(port)) {
        continue;
      }

      const morphId = rawMorphId.toLowerCase();
      const instanceId = toInstanceId(morphId);
      if (!instanceId) {
        continue;
      }

      return {
        hostname,
        morphId,
        instanceId,
        port,
        source: "cmux-port",
      };
    }
  }

  return null;
}

export function extractMorphInstanceInfo(input: string | URL): MorphInstanceInfo | null {
  let url: URL;
  if (typeof input === "string") {
    try {
      url = new URL(input);
    } catch {
      return null;
    }
  } else {
    url = input;
  }

  const hostname = url.hostname.toLowerCase();

  return (
    parseDirectMorphHost(hostname) ??
    parseCmuxProxyHost(hostname)
  );
}
