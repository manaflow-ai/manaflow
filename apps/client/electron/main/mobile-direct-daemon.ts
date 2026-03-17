import type { ChildProcess } from "node:child_process";
import { spawn as spawnProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

export type MobileDirectConnectInfo = {
  directPort: number;
  directTlsPins: string[];
  ticketSecret: string;
};

type DirectDaemonHosts = {
  machineId: string;
  hostname: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
};

type DirectDaemonMaterial = {
  certPath: string;
  keyPath: string;
  ticketSecret: string;
  pin: string;
  hosts: string[];
};

type ActiveDaemonState = {
  child: ChildProcess;
  info: MobileDirectConnectInfo;
  machineId: string;
  hosts: string[];
  binaryPath: string;
};

type MobileDirectDaemonManagerDependencies = {
  resolveBinaryPath?: () => string | null;
  getUserDataPath?: () => string;
  allocatePort?: () => Promise<number>;
  spawn?: typeof spawnProcess;
};

const DEFAULT_DIRECT_DAEMON_PORT = 9443;

export function normalizeDirectDaemonHosts(values: Array<string | undefined>): string[] {
  const uniqueHosts = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    uniqueHosts.add(trimmed.replace(/\.+$/, ""));
  }
  return [...uniqueHosts];
}

export function buildSelfSignedDirectDaemonCertificate(hosts: string[]) {
  if (hosts.length === 0) {
    throw new Error("at least one host is required for direct daemon certificates");
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const commonName = hosts.find((value) => net.isIP(value) === 0) ?? hosts[0]!;
  const attrs = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "Cmux Mobile Direct" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
    },
    {
      name: "subjectAltName",
      altNames: hosts.map((value) =>
        net.isIP(value)
          ? {
              type: 7,
              ip: value,
            }
          : {
              type: 2,
              value,
            },
      ),
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  return {
    certPem,
    keyPem,
    pin: computeCertificatePin(certPem),
  };
}

export function computeCertificatePin(certPem: string): string {
  const certificate = forge.pki.certificateFromPem(certPem);
  const asn1Certificate = forge.pki.certificateToAsn1(certificate);
  const derBytes = forge.asn1.toDer(asn1Certificate).getBytes();
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(derBytes, "binary"))
    .digest("hex");
  return `sha256:${digest}`;
}

export function resolveCmuxdRemoteBinaryPath(args?: {
  homedir?: () => string;
  arch?: string;
  existsSync?: (value: string) => boolean;
}) {
  const homedir = args?.homedir ?? os.homedir;
  const arch = args?.arch ?? process.arch;
  const existsSync = args?.existsSync ?? fs.existsSync;
  const archDirectory =
    arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-amd64" : null;

  const candidates = [
    process.env.CMUXD_REMOTE_PATH,
    path.join(homedir(), ".cmux", "bin", "cmuxd-remote-current"),
    ...(archDirectory
      ? [
          path.join(
            homedir(),
            "fun",
            "cmuxterm-hq",
            "worktrees",
            "task-move-ios-app-into-cmux-repo",
            "ios",
            "Resources",
            "cmuxd-remote",
            "dev",
            archDirectory,
            "cmuxd-remote",
          ),
          path.join(
            homedir(),
            "fun",
            "cmuxterm-hq",
            "repo",
            "ios",
            "Resources",
            "cmuxd-remote",
            "dev",
            archDirectory,
            "cmuxd-remote",
          ),
        ]
      : []),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return candidates.find((value) => existsSync(value)) ?? null;
}

function sanitizeMachineDirectoryName(machineId: string): string {
  return crypto.createHash("sha256").update(machineId).digest("hex");
}

function arraysEqual(lhs: string[], rhs: string[]) {
  return lhs.length === rhs.length && lhs.every((value, index) => value === rhs[index]);
}

function readJSON<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function allocateFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : DEFAULT_DIRECT_DAEMON_PORT;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForChildSpawn(child: ChildProcess) {
  if (child.pid) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const handleSpawn = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.off("spawn", handleSpawn);
      child.off("error", handleError);
    };
    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}

function ensureDirectDaemonMaterial(baseDirectory: string, hosts: string[]): DirectDaemonMaterial {
  fs.mkdirSync(baseDirectory, { recursive: true });

  const certPath = path.join(baseDirectory, "server.crt");
  const keyPath = path.join(baseDirectory, "server.key");
  const ticketSecretPath = path.join(baseDirectory, "ticket-secret.txt");
  const metadataPath = path.join(baseDirectory, "metadata.json");

  const existingMetadata = readJSON<{ hosts?: string[] }>(metadataPath);
  const existingSecret = fs.existsSync(ticketSecretPath)
    ? fs.readFileSync(ticketSecretPath, "utf8").trim()
    : "";
  const shouldRegenerateCertificate =
    !fs.existsSync(certPath) ||
    !fs.existsSync(keyPath) ||
    !arraysEqual(existingMetadata?.hosts ?? [], hosts);

  if (shouldRegenerateCertificate) {
    const bundle = buildSelfSignedDirectDaemonCertificate(hosts);
    fs.writeFileSync(certPath, bundle.certPem, { mode: 0o600 });
    fs.writeFileSync(keyPath, bundle.keyPem, { mode: 0o600 });
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          hosts,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const ticketSecret = existingSecret || crypto.randomBytes(32).toString("hex");
  if (!existingSecret) {
    fs.writeFileSync(ticketSecretPath, ticketSecret, { mode: 0o600 });
  }

  const certPem = fs.readFileSync(certPath, "utf8");
  return {
    certPath,
    keyPath,
    ticketSecret,
    pin: computeCertificatePin(certPem),
    hosts,
  };
}

class MobileDirectDaemonManager {
  private readonly resolveBinaryPath: NonNullable<
    MobileDirectDaemonManagerDependencies["resolveBinaryPath"]
  >;
  private readonly getUserDataPath: NonNullable<
    MobileDirectDaemonManagerDependencies["getUserDataPath"]
  >;
  private readonly allocatePort: NonNullable<
    MobileDirectDaemonManagerDependencies["allocatePort"]
  >;
  private readonly spawn: NonNullable<MobileDirectDaemonManagerDependencies["spawn"]>;
  private activeState: ActiveDaemonState | null = null;

  constructor(dependencies?: MobileDirectDaemonManagerDependencies) {
    this.resolveBinaryPath =
      dependencies?.resolveBinaryPath ?? (() => resolveCmuxdRemoteBinaryPath());
    this.getUserDataPath =
      dependencies?.getUserDataPath ?? (() => path.join(os.homedir(), ".cmux"));
    this.allocatePort = dependencies?.allocatePort ?? allocateFreePort;
    this.spawn = dependencies?.spawn ?? spawnProcess;
  }

  async ensureConnection(hosts: DirectDaemonHosts): Promise<MobileDirectConnectInfo | null> {
    if (!hosts.tailscaleHostname && hosts.tailscaleIPs.length === 0) {
      return null;
    }

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath) {
      console.warn("[mobile-direct-daemon] cmuxd-remote binary not found");
      return null;
    }

    const normalizedHosts = normalizeDirectDaemonHosts([
      hosts.machineId,
      hosts.hostname,
      hosts.tailscaleHostname,
      ...hosts.tailscaleIPs,
    ]);

    if (
      this.activeState &&
      this.activeState.machineId === hosts.machineId &&
      this.activeState.binaryPath === binaryPath &&
      arraysEqual(this.activeState.hosts, normalizedHosts) &&
      this.activeState.child.exitCode === null &&
      !this.activeState.child.killed
    ) {
      return this.activeState.info;
    }

    this.shutdown();

    const baseDirectory = path.join(
      this.getUserDataPath(),
      "mobile-direct-daemon",
      sanitizeMachineDirectoryName(hosts.machineId),
    );
    const material = ensureDirectDaemonMaterial(baseDirectory, normalizedHosts);
    const port = await this.allocatePort();

    const child = this.spawn(
      binaryPath,
      [
        "serve",
        "--tls",
        "--listen",
        `0.0.0.0:${port}`,
        "--server-id",
        hosts.machineId,
        "--ticket-secret",
        material.ticketSecret,
        "--cert-file",
        material.certPath,
        "--key-file",
        material.keyPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message.length > 0) {
        console.error("[mobile-direct-daemon]", message);
      }
    });

    await waitForChildSpawn(child);

    const info = {
      directPort: port,
      directTlsPins: [material.pin],
      ticketSecret: material.ticketSecret,
    } satisfies MobileDirectConnectInfo;

    child.once("exit", () => {
      if (this.activeState?.child === child) {
        this.activeState = null;
      }
    });

    this.activeState = {
      child,
      info,
      machineId: hosts.machineId,
      hosts: normalizedHosts,
      binaryPath,
    };

    return info;
  }

  shutdown() {
    if (!this.activeState) {
      return;
    }
    const child = this.activeState.child;
    this.activeState = null;
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
}

const mobileDirectDaemonManager = new MobileDirectDaemonManager();

export async function ensureMobileDirectDaemonConnection(hosts: DirectDaemonHosts) {
  return await mobileDirectDaemonManager.ensureConnection(hosts);
}

export function shutdownMobileDirectDaemon() {
  mobileDirectDaemonManager.shutdown();
}
