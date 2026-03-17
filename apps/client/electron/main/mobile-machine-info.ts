import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import {
  ensureMobileDirectDaemonConnection,
  type MobileDirectConnectInfo,
} from "./mobile-direct-daemon";

const execFile = promisify(execFileCallback);

const TAILSCALE_BINARY_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "tailscale",
];

type TailscaleStatusPayload = {
  BackendState?: string;
  Self?: {
    HostName?: string;
    DNSName?: string;
    TailscaleIPs?: string[];
  };
};

export type MobileMachineInfo = {
  machineId: string;
  displayName: string;
  hostname: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
  directConnect?: MobileDirectConnectInfo;
};

export function trimTailscaleHostname(value?: string | null): string | undefined {
  const trimmed = value?.trim().replace(/\.+$/, "");
  return trimmed ? trimmed : undefined;
}

export function parseTailscaleStatus(stdout: string): {
  running: boolean;
  displayName?: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
} {
  const payload = JSON.parse(stdout) as TailscaleStatusPayload;
  const backendState = payload.BackendState?.trim();
  const hostName = payload.Self?.HostName?.trim();
  const tailscaleHostname = trimTailscaleHostname(payload.Self?.DNSName);
  const tailscaleIPs = (payload.Self?.TailscaleIPs ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  return {
    running: backendState === "Running",
    displayName: hostName && hostName.length > 0 ? hostName : undefined,
    tailscaleHostname,
    tailscaleIPs,
  };
}

async function loadTailscaleStatus(): Promise<ReturnType<typeof parseTailscaleStatus> | null> {
  for (const binary of TAILSCALE_BINARY_CANDIDATES) {
    try {
      const { stdout } = await execFile(binary, ["status", "--json"], {
        timeout: 1_500,
      });
      return parseTailscaleStatus(stdout);
    } catch {
      continue;
    }
  }

  return null;
}

export async function getMobileMachineInfo(options?: {
  loadTailscaleStatus?: () => Promise<ReturnType<typeof parseTailscaleStatus> | null>;
  resolveDirectConnect?: (args: {
    machineId: string;
    hostname: string;
    tailscaleHostname?: string;
    tailscaleIPs: string[];
  }) => Promise<MobileDirectConnectInfo | null>;
}): Promise<MobileMachineInfo> {
  const hostname = os.hostname().trim().replace(/\.local$/i, "");
  const tailscale = await (options?.loadTailscaleStatus ?? loadTailscaleStatus)();
  const tailscaleHostname = tailscale?.running ? tailscale.tailscaleHostname : undefined;
  const tailscaleIPs = tailscale?.running ? tailscale.tailscaleIPs : [];
  const displayName = tailscale?.displayName ?? hostname;
  const machineId = tailscaleHostname ?? hostname;
  const directConnect =
    tailscale?.running
      ? await (options?.resolveDirectConnect ?? ensureMobileDirectDaemonConnection)({
          machineId,
          hostname,
          tailscaleHostname,
          tailscaleIPs,
        })
      : null;

  return {
    machineId,
    displayName,
    hostname,
    tailscaleHostname,
    tailscaleIPs,
    directConnect: directConnect ?? undefined,
  };
}
