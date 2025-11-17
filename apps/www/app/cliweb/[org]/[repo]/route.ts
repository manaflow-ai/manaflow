import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { MorphCloudClient } from "morphcloud";
import { DEFAULT_MORPH_SNAPSHOT_ID } from "@/lib/utils/morph-defaults";
import { singleQuote } from "@/lib/routes/sandboxes/shell";
import { env } from "@/lib/utils/www-env";

const require = createRequire(import.meta.url);

const XTERM_JS_PATH = require.resolve("@xterm/xterm/lib/xterm.js");
const XTERM_CSS_PATH = require.resolve("@xterm/xterm/css/xterm.css");
const XTERM_FIT_PATH = require.resolve("@xterm/addon-fit/lib/addon-fit.js");
const XTERM_ATTACH_PATH = require.resolve(
  "@xterm/addon-attach/lib/addon-attach.js"
);
const XTERM_WEB_LINKS_PATH = require.resolve(
  "@xterm/addon-web-links/lib/addon-web-links.js"
);
const XTERM_UNICODE_PATH = require.resolve(
  "@xterm/addon-unicode11/lib/addon-unicode11.js"
);
const XTERM_WEBGL_PATH = require.resolve(
  "@xterm/addon-webgl/lib/addon-webgl.js"
);
const XTERM_SEARCH_PATH = require.resolve(
  "@xterm/addon-search/lib/addon-search.js"
);

const WORKSPACE_DIR = "/root/workspace";
const XTERM_HTTP_PORT = 39383;

type MorphInstance = Awaited<
  ReturnType<MorphCloudClient["instances"]["start"]>
>;

interface XtermAssets {
  css: string;
  xtermJs: string;
  fitJs: string;
  attachJs: string;
  webLinksJs: string;
  unicodeJs: string;
  webglJs: string;
  searchJs: string;
}

let cachedAssetsPromise: Promise<XtermAssets> | null = null;

async function loadAsset(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function loadXtermAssets(): Promise<XtermAssets> {
  const [
    css,
    xtermJs,
    fitJs,
    attachJs,
    webLinksJs,
    unicodeJs,
    webglJs,
    searchJs,
  ] = await Promise.all([
    loadAsset(XTERM_CSS_PATH),
    loadAsset(XTERM_JS_PATH),
    loadAsset(XTERM_FIT_PATH),
    loadAsset(XTERM_ATTACH_PATH),
    loadAsset(XTERM_WEB_LINKS_PATH),
    loadAsset(XTERM_UNICODE_PATH),
    loadAsset(XTERM_WEBGL_PATH),
    loadAsset(XTERM_SEARCH_PATH),
  ]);
  return {
    css,
    xtermJs,
    fitJs,
    attachJs,
    webLinksJs,
    unicodeJs,
    webglJs,
    searchJs,
  };
}

function getXtermAssets(): Promise<XtermAssets> {
  if (!cachedAssetsPromise) {
    cachedAssetsPromise = loadXtermAssets();
  }
  return cachedAssetsPromise;
}

function isValidSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeForTag(value: string, tag: "script" | "style"): string {
  const closing = `</${tag}>`;
  const replacement = `<\\/${tag}>`;
  return value.split(closing).join(replacement);
}

function buildServiceBaseUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function buildWsUrl(base: URL, wsPath: string): string {
  const wsUrl = new URL(base.toString());
  wsUrl.pathname = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  wsUrl.search = "";
  wsUrl.hash = "";
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  return wsUrl.toString();
}

function formatCloneLog(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) {
    return "git clone completed with no output.";
  }
  return combined;
}

function extractHttpService(instance: MorphInstance, port: number) {
  return instance.networking.httpServices.find(
    (service) => service.port === port
  );
}

async function cloneRepository({
  instance,
  org,
  repo,
}: {
  instance: MorphInstance;
  org: string;
  repo: string;
}) {
  const repoUrl = `https://github.com/${org}/${repo}.git`;
  const safeRepoPath = `${WORKSPACE_DIR}/${repo}`;
const command = `
set -e
mkdir -p ${WORKSPACE_DIR}
cd ${WORKSPACE_DIR}
rm -rf ${singleQuote(repo)}
(bun add -g opencode-ai@latest >/tmp/opencode-install.log 2>&1) &
INSTALL_PID=$!
git clone --depth=1 ${singleQuote(repoUrl)} ${singleQuote(repo)}
wait $INSTALL_PID
`;
  const result = await instance.exec(`bash -lc ${singleQuote(command)}`);
  if (result.exit_code !== 0) {
    throw new Error(
      `git clone failed with exit ${result.exit_code}: ${result.stderr || result.stdout}`
    );
  }
  return {
    repoPath: safeRepoPath,
    log: formatCloneLog(result.stdout ?? "", result.stderr ?? ""),
  };
}

async function createTerminalSession({
  baseUrl,
  repoPath,
}: {
  baseUrl: URL;
  repoPath: string;
}) {
  const createUrl = new URL("/api/tabs", baseUrl);
  const response = await fetch(createUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cmd: "/bin/bash",
      args: [
        "-lc",
        `cd ${singleQuote(
          repoPath
        )} && (bunx opencode-ai --port 4096 --hostname 0.0.0.0 || true); exec /bin/bash`,
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create terminal tab (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof Reflect.get(payload, "id") !== "string" ||
    typeof Reflect.get(payload, "ws_url") !== "string"
  ) {
    throw new Error("Unexpected response while creating terminal tab.");
  }

  const id = Reflect.get(payload, "id") as string;
  const wsPath = Reflect.get(payload, "ws_url") as string;
  const wsUrl = buildWsUrl(baseUrl, wsPath);

  return { id, wsUrl };
}

interface PageInput {
  org: string;
  repo: string;
  wsUrl: string;
  instanceId: string;
}

function renderSuccessPage(input: PageInput, assets: XtermAssets): string {
  const { org, repo, wsUrl, instanceId } = input;
  const css = escapeForTag(assets.css, "style");
  const xtermJs = escapeForTag(assets.xtermJs, "script");
  const fitJs = escapeForTag(assets.fitJs, "script");
  const attachJs = escapeForTag(assets.attachJs, "script");
  const webLinksJs = escapeForTag(assets.webLinksJs, "script");
  const unicodeJs = escapeForTag(assets.unicodeJs, "script");
  const webglJs = escapeForTag(assets.webglJs, "script");
  const searchJs = escapeForTag(assets.searchJs, "script");

  const bootstrap = escapeForTag(
    `
(function () {
  const wsUrl = ${JSON.stringify(wsUrl)};
  const terminalContainer = document.getElementById("cliweb-terminal");

  function resolveCtor(factory, key) {
    if (!factory) {
      return null;
    }
    if (typeof factory === "function") {
      return factory;
    }
    if (factory && typeof factory === "object") {
      if (typeof factory[key] === "function") {
        return factory[key];
      }
      if (typeof factory.default === "function") {
        return factory.default;
      }
    }
    return null;
  }

  const TerminalCtor = resolveCtor(window.Terminal, "Terminal");
  if (!TerminalCtor || !terminalContainer) {
    console.error("Terminal runtime unavailable.");
    return;
  }

  const term = new TerminalCtor({
    allowProposedApi: true,
    convertEol: true,
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    theme: {
      background: "#050505",
      foreground: "#f6f6f6",
      cursor: "#f6f6f6",
    },
  });

  function loadAddon(factory, key, args) {
    const Ctor = resolveCtor(factory, key);
    if (!Ctor) {
      return null;
    }
    try {
      const instance = Array.isArray(args) ? new Ctor(...args) : new Ctor();
      term.loadAddon(instance);
      return instance;
    } catch (error) {
      console.error("Failed to load addon", key, error);
      return null;
    }
  }

  const fitAddon = loadAddon(window.FitAddon, "FitAddon");
  loadAddon(window.WebLinksAddon, "WebLinksAddon");
  loadAddon(window.Unicode11Addon, "Unicode11Addon");
  loadAddon(window.SearchAddon, "SearchAddon");
  try {
    loadAddon(window.WebglAddon, "WebglAddon");
  } catch (error) {
    console.warn("WebGL addon unavailable", error);
  }

  term.open(terminalContainer);
  fitAddon?.fit();
  term.focus();

  const banner = (text) => {
    term.writeln("\\x1b[38;2;180;180;180m[cmux]\\x1b[0m " + text);
  };
  banner("Sandbox ready for ${escapeHtml(org)}/${escapeHtml(repo)}");
  banner("Morph instance ${escapeHtml(instanceId)}. Connecting terminal…");

  const socket = new WebSocket(wsUrl);
  socket.binaryType = "arraybuffer";

  function sendResize() {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "resize",
        cols: term.cols,
        rows: term.rows,
      })
    );
  }

  term.onResize(() => {
    sendResize();
  });

  window.addEventListener("resize", () => {
    fitAddon?.fit();
    sendResize();
  });

  socket.addEventListener("open", () => {
    banner("Terminal connected.");
    const attachAddonCtor = resolveCtor(window.AttachAddon, "AttachAddon");
    if (attachAddonCtor) {
      const attachAddon = new attachAddonCtor(socket);
      term.loadAddon(attachAddon);
    } else {
      banner("Attach addon missing.");
    }
    requestAnimationFrame(() => {
      fitAddon?.fit();
      sendResize();
      term.focus();
    });
  });

  socket.addEventListener("close", () => {
    banner("Terminal closed.");
  });

  socket.addEventListener("error", () => {
    banner("Terminal connection error.");
  });
})();
`,
    "script"
  );

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cmux cliweb for ${escapeHtml(org)}/${escapeHtml(repo)}</title>
    <style>${css}</style>
    <style>
      :root {
        color-scheme: dark;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #020202;
      }
      body {
        font-family: "Inter", "SF Pro Display", system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cliweb-terminal {
        position: fixed;
        inset: 0;
      }
    </style>
  </head>
  <body>
    <div id="cliweb-terminal" role="presentation"></div>
    <script>${xtermJs}</script>
    <script>${fitJs}</script>
    <script>${attachJs}</script>
    <script>${webLinksJs}</script>
    <script>${unicodeJs}</script>
    <script>${webglJs}</script>
    <script>${searchJs}</script>
    <script>${bootstrap}</script>
  </body>
</html>`;
}

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cmux cliweb error</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
        background: #050505;
        color: #f5f5f5;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
      }
      .card {
        max-width: 540px;
        padding: 1.5rem;
        border-radius: 0.75rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 1.25rem;
      }
      p {
        margin: 0;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Unable to prepare sandbox</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  </body>
</html>`;
}

async function stopInstanceSafely(instance: MorphInstance | null) {
  if (!instance) {
    return;
  }
  try {
    await instance.stop();
  } catch (error) {
    console.error("[cliweb] Failed to stop Morph instance", error);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ org: string; repo: string }> }
) {
  const { org: rawOrg, repo: rawRepo } = await context.params;
  const org = rawOrg ?? "";
  const repo = rawRepo ?? "";

  if (!isValidSegment(org) || !isValidSegment(repo)) {
    const html = renderErrorPage("Invalid GitHub repository path.");
    return new NextResponse(html, {
      status: 400,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  let instance: MorphInstance | null = null;

  try {
    const client = new MorphCloudClient({
      apiKey: env.MORPH_API_KEY,
    });

    console.log(`[cliweb] Spawning Morph sandbox for ${org}/${repo}`);
    instance = await client.instances.start({
      snapshotId: DEFAULT_MORPH_SNAPSHOT_ID,
      ttlSeconds: 60 * 10, // 10 minutes
      ttlAction: "stop",
      metadata: {
        source: "cliweb",
        org,
        repo,
      },
    });

    const xtermService = extractHttpService(instance, XTERM_HTTP_PORT);
    if (!xtermService) {
      throw new Error("Morph instance does not expose the xterm service.");
    }

    const { repoPath, log } = await cloneRepository({ instance, org, repo });
    console.log(`[cliweb] Cloned ${org}/${repo} into sandbox ${instance.id}`);
    if (log) {
      console.log(`[cliweb] git clone output for ${org}/${repo}]:\n${log}`);
    }

    const xtermBase = buildServiceBaseUrl(xtermService.url);
    const terminalTab = await createTerminalSession({
      baseUrl: xtermBase,
      repoPath,
    });

    const assets = await getXtermAssets();
    const html = renderSuccessPage(
      {
        org,
        repo,
        wsUrl: terminalTab.wsUrl,
        instanceId: instance.id,
      },
      assets
    );

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[cliweb] Failed to prepare sandbox", error);
    await stopInstanceSafely(instance);
    const message =
      error instanceof Error ? error.message : "Unknown server error.";
    const html = renderErrorPage(message);
    return new NextResponse(html, {
      status: 500,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
