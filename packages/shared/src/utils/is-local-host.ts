const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "[::ffff:127.0.0.1]",
]);

const IPV4_OCTET = /^(\d{1,3})$/;

function parseIpv4Octets(hostname: string): number[] | null {
  const segments = hostname.split(".");

  if (segments.length !== 4) {
    return null;
  }

  const octets: number[] = [];

  for (const segment of segments) {
    const match = IPV4_OCTET.exec(segment);

    if (!match) {
      return null;
    }

    const value = Number(match[1]);

    if (Number.isNaN(value) || value < 0 || value > 255) {
      return null;
    }

    octets.push(value);
  }

  return octets;
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);

  if (!octets) {
    return false;
  }

  return octets[0] === 127;
}

function isPrivateLanIpv4(hostname: string): boolean {
  const octets = parseIpv4Octets(hostname);

  if (!octets) {
    return false;
  }

  const first = octets[0];
  const second = octets[1];

  if (first === undefined || second === undefined) {
    return false;
  }

  if (first === 10) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  return false;
}

export function isLoopbackHostname(
  hostname: string | null | undefined,
): boolean {
  if (!hostname) {
    return false;
  }

  const lower = hostname.toLowerCase();

  if (LOOPBACK_HOSTS.has(lower)) {
    return true;
  }

  if (lower.endsWith(".localhost")) {
    return true;
  }

  if (isLoopbackIpv4(lower)) {
    return true;
  }

  if (
    lower.startsWith("::ffff:") &&
    isLoopbackIpv4(lower.slice(7))
  ) {
    return true;
  }

  if (
    lower.startsWith("[::ffff:") &&
    lower.endsWith("]") &&
    isLoopbackIpv4(lower.slice(8, -1))
  ) {
    return true;
  }

  return false;
}

export function isLocalHostname(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }

  const lower = hostname.toLowerCase();

  if (isLoopbackHostname(lower)) {
    return true;
  }

  if (lower.endsWith(".local")) {
    return true;
  }

  if (isLoopbackIpv4(lower) || isPrivateLanIpv4(lower)) {
    return true;
  }

  if (
    lower.startsWith("::ffff:") &&
    (isLoopbackIpv4(lower.slice(7)) || isPrivateLanIpv4(lower.slice(7)))
  ) {
    return true;
  }

  if (
    lower.startsWith("[::ffff:") &&
    lower.endsWith("]") &&
    (isLoopbackIpv4(lower.slice(8, -1)) ||
      isPrivateLanIpv4(lower.slice(8, -1)))
  ) {
    return true;
  }

  return false;
}
