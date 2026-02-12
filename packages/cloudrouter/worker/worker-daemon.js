#!/usr/bin/env node
/**
 * Worker Daemon for E2B cmux sandbox
 *
 * HTTP server that provides API endpoints for sandbox operations.
 * Runs on port 39377.
 *
 * Features:
 * - Authentication via Bearer token
 * - Command execution
 * - PTY sessions via WebSocket
 * - SSH server with token-as-username auth (like Morph)
 * - Browser agent control via Chrome CDP
 * - File operations
 */

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { Server: SSHServer, utils: sshUtils } = require("ssh2");

const PORT = process.env.PORT || 39377;
const SSH_PORT = process.env.SSH_PORT || 10000;
const CDP_PORT = process.env.CDP_PORT || 9222;
const VSCODE_PORT = 39378;
const VNC_PORT = 39380;

// Auth token file path
const AUTH_TOKEN_PATH = "/home/user/.worker-auth-token";
const VSCODE_TOKEN_PATH = "/home/user/.vscode-token";
const AUTH_COOKIE_NAME = "_cmux_auth";
// File to track which boot this token was generated for
const TOKEN_BOOT_ID_PATH = "/home/user/.token-boot-id";

// Current auth token (will be regenerated if boot_id changes)
let AUTH_TOKEN = null;

/**
 * Get current kernel boot ID
 * This changes on every fresh boot, even when resuming from snapshot
 */
function getCurrentBootId() {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Get saved boot ID from when token was last generated
 */
function getSavedBootId() {
  try {
    return fs.readFileSync(TOKEN_BOOT_ID_PATH, "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Update VNC password to match token (first 8 chars)
 */
function updateVncPassword(token) {
  try {
    const vncPassword = token.substring(0, 8);
    const { execSync } = require("child_process");
    // Use vncpasswd to update the password
    execSync(`echo "${vncPassword}" | vncpasswd -f > /home/user/.vnc/passwd`, {
      shell: "/bin/bash",
    });
    fs.chmodSync("/home/user/.vnc/passwd", 0o600);
    console.log(`[worker-daemon] VNC password updated to match token`);
  } catch (e) {
    console.error("[worker-daemon] Failed to update VNC password:", e.message);
  }
}

/**
 * Generate fresh auth token and save with current boot ID
 */
function generateFreshAuthToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const bootId = getCurrentBootId();
  try {
    // Write to both worker and vscode token files
    fs.writeFileSync(AUTH_TOKEN_PATH, token, { mode: 0o644 });
    fs.writeFileSync(VSCODE_TOKEN_PATH, token, { mode: 0o644 });
    // Record which boot this token is for
    if (bootId) {
      fs.writeFileSync(TOKEN_BOOT_ID_PATH, bootId, { mode: 0o644 });
    }
    // Also update VNC password to stay in sync
    updateVncPassword(token);
    console.log(`[worker-daemon] Fresh auth token generated: ${token.substring(0, 8)}...`);
  } catch (e) {
    console.error("[worker-daemon] Failed to save auth token:", e.message);
  }
  return token;
}

/**
 * Get existing token from file
 */
function getExistingToken() {
  try {
    return fs.readFileSync(AUTH_TOKEN_PATH, "utf-8").trim();
  } catch (e) {
    return null;
  }
}

/**
 * Check if token needs regeneration and regenerate if needed
 * Called on every authenticated request to ensure fresh boot detection
 */
function ensureValidToken() {
  const currentBootId = getCurrentBootId();
  const savedBootId = getSavedBootId();

  // If boot ID changed or missing, regenerate token
  if (!currentBootId || !savedBootId || currentBootId !== savedBootId) {
    console.log(`[worker-daemon] Boot ID changed (${savedBootId?.substring(0, 8) || 'none'} -> ${currentBootId?.substring(0, 8) || 'none'}), regenerating token`);
    AUTH_TOKEN = generateFreshAuthToken();
    return AUTH_TOKEN;
  }

  // Use existing token if boot ID matches
  if (!AUTH_TOKEN) {
    AUTH_TOKEN = getExistingToken() || generateFreshAuthToken();
  }
  return AUTH_TOKEN;
}

// Initialize auth token on startup
AUTH_TOKEN = ensureValidToken();

/**
 * Parse cookies from request
 */
function parseCookies(req) {
  const cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split("=");
      if (name && rest.length > 0) {
        cookies[name] = decodeURIComponent(rest.join("="));
      }
    });
  }
  return cookies;
}

/**
 * Set auth cookie
 */
function setAuthCookie(res, token) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "Max-Age=86400", // 24 hours
  ];
  res.setHeader("Set-Cookie", parts.join("; "));
}

/**
 * Get auth token from request (header, query, or cookie)
 */
function getAuthTokenFromRequest(req, url) {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
  }

  // Check query parameter
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  // Check cookie
  const cookies = parseCookies(req);
  if (cookies[AUTH_COOKIE_NAME]) {
    return cookies[AUTH_COOKIE_NAME];
  }

  return null;
}

/**
 * Verify authentication
 * Also checks for boot ID changes and regenerates token if needed
 */
function verifyAuth(req, url) {
  // Always ensure token is valid for current boot
  ensureValidToken();

  const token = getAuthTokenFromRequest(req, url);
  if (!token) {
    return false;
  }

  return token === AUTH_TOKEN;
}

/**
 * Execute a shell command and return the result
 */
async function execCommand(command, timeout = 60000, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      timeout,
      env: { ...process.env, ...env, FORCE_COLOR: "0" },
      cwd: process.env.WORKSPACE || "/home/user/workspace",
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exit_code: code || 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exit_code: 1,
      });
    });
  });
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Get Chrome CDP WebSocket URL with timeout
 */
async function getCdpWebSocketUrl(timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://localhost:${CDP_PORT}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`CDP version endpoint returned ${response.status}`);
    }
    const data = await response.json();
    return data.webSocketDebuggerUrl;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      console.error("[worker-daemon] CDP WebSocket URL request timed out");
    } else {
      console.error("[worker-daemon] Failed to get CDP WebSocket URL:", e.message);
    }
    return null;
  }
}

/**
 * Get or create browser connection using puppeteer-core
 */
let browserInstance = null;

async function getBrowser(timeoutMs = 10000) {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  try {
    const puppeteer = require("puppeteer-core");
    const cdpUrl = await getCdpWebSocketUrl();
    if (!cdpUrl) {
      throw new Error("Chrome CDP not available");
    }

    // Add timeout to puppeteer.connect
    const connectPromise = puppeteer.connect({
      browserWSEndpoint: cdpUrl,
      defaultViewport: null,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Browser connection timed out")), timeoutMs)
    );

    browserInstance = await Promise.race([connectPromise, timeoutPromise]);

    return browserInstance;
  } catch (e) {
    console.error("[worker-daemon] Failed to connect to browser:", e.message);
    throw e;
  }
}

/**
 * Get the active page or create one
 */
async function getActivePage() {
  const browser = await getBrowser();
  const pages = await browser.pages();
  if (pages.length > 0) {
    return pages[0];
  }
  return await browser.newPage();
}

/**
 * Build accessibility tree snapshot with element refs
 */
async function buildAccessibilitySnapshot(page) {
  const snapshot = await page.accessibility.snapshot();
  if (!snapshot) {
    return "No accessibility tree available";
  }

  let refCounter = 1;
  const lines = [];

  function traverse(node, indent = 0) {
    const prefix = "  ".repeat(indent);
    const ref = `@e${refCounter++}`;
    let line = `${prefix}${ref} [${node.role}]`;

    if (node.name) {
      line += ` "${node.name}"`;
    }
    if (node.value) {
      line += ` value="${node.value}"`;
    }
    if (node.focused) {
      line += " (focused)";
    }

    lines.push(line);

    if (node.children) {
      for (const child of node.children) {
        traverse(child, indent + 1);
      }
    }
  }

  traverse(snapshot);
  return lines.join("\n");
}

/**
 * Find element by ref (e.g., @e1) or CSS selector
 */
async function findElement(page, selector) {
  if (selector.startsWith("@e")) {
    // Element ref - need to find by accessibility tree position
    const refNum = parseInt(selector.substring(2));
    const snapshot = await page.accessibility.snapshot();
    if (!snapshot) {
      throw new Error("Cannot find element: no accessibility tree");
    }

    let counter = 0;
    let targetNode = null;

    function findByRef(node) {
      counter++;
      if (counter === refNum) {
        targetNode = node;
        return true;
      }
      if (node.children) {
        for (const child of node.children) {
          if (findByRef(child)) return true;
        }
      }
      return false;
    }

    findByRef(snapshot);

    if (!targetNode) {
      throw new Error(`Element ${selector} not found`);
    }

    // Try to find by role and name
    const role = targetNode.role.toLowerCase();
    const name = targetNode.name;

    // Use aria selectors
    if (name) {
      const element = await page.$(`[aria-label="${name}"], [title="${name}"], [name="${name}"]`);
      if (element) return element;

      // Try text content match
      const elements = await page.$$(`${role}, button, a, input, [role="${role}"]`);
      for (const el of elements) {
        const text = await el.evaluate(e => e.textContent || e.value || e.getAttribute('aria-label') || e.getAttribute('title'));
        if (text && text.includes(name)) {
          return el;
        }
      }
    }

    throw new Error(`Could not locate element ${selector} in DOM`);
  } else {
    // CSS selector
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element ${selector} not found`);
    }
    return element;
  }
}

/**
 * Execute a browser command
 */
async function execBrowserCommand(command, params) {
  try {
    const page = await getActivePage();

    switch (command) {
      case "snapshot": {
        const snapshot = await buildAccessibilitySnapshot(page);
        return { data: { snapshot } };
      }

      case "open": {
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        return { data: { url: params.url } };
      }

      case "click": {
        const element = await findElement(page, params.selector);
        await element.click();
        return { data: { clicked: params.selector } };
      }

      case "type": {
        await page.keyboard.type(params.text);
        return { data: { typed: params.text } };
      }

      case "fill": {
        const element = await findElement(page, params.selector);
        await element.click({ clickCount: 3 }); // Select all
        await element.type(params.value);
        return { data: { filled: params.selector, value: params.value } };
      }

      case "press": {
        await page.keyboard.press(params.key);
        return { data: { pressed: params.key } };
      }

      case "scroll": {
        const direction = params.direction.toLowerCase();
        const delta = direction === "up" ? -500 : 500;
        await page.evaluate((d) => window.scrollBy(0, d), delta);
        return { data: { scrolled: direction } };
      }

      case "back": {
        await page.goBack({ waitUntil: "domcontentloaded" });
        return { data: { navigated: "back" } };
      }

      case "forward": {
        await page.goForward({ waitUntil: "domcontentloaded" });
        return { data: { navigated: "forward" } };
      }

      case "reload": {
        await page.reload({ waitUntil: "domcontentloaded" });
        return { data: { reloaded: true } };
      }

      case "url": {
        const url = page.url();
        return { data: { url } };
      }

      case "title": {
        const title = await page.title();
        return { data: { title } };
      }

      case "wait": {
        const timeout = params.timeout || 30000;
        if (params.selector.startsWith("@e")) {
          // For element refs, just wait a bit and try to find
          await new Promise(r => setTimeout(r, 1000));
          await findElement(page, params.selector);
        } else {
          await page.waitForSelector(params.selector, { timeout });
        }
        return { data: { found: params.selector } };
      }

      case "hover": {
        const element = await findElement(page, params.selector);
        await element.hover();
        return { data: { hovered: params.selector } };
      }

      default:
        return { error: `Unknown command: ${command}` };
    }
  } catch (e) {
    console.error(`[worker-daemon] Browser command ${command} failed:`, e.message);
    return { error: e.message };
  }
}

/**
 * Run browser agent with prompt
 */
async function runBrowserAgent(prompt, options = {}) {
  const { timeout = 120000, screenshotPath } = options;

  // Build environment
  const env = {};
  if (process.env.ANTHROPIC_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  env.CDP_ENDPOINT = `http://localhost:${CDP_PORT}`;
  env.BROWSER_AGENT_PROMPT = prompt;
  if (screenshotPath) {
    env.BROWSER_AGENT_SCREENSHOT_PATH = screenshotPath;
  }

  // Run browser agent (plain JS, no ts-node needed)
  const result = await execCommand(
    `node /usr/local/bin/browser-agent-runner.js`,
    timeout,
    env
  );

  return result;
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check - no auth required
  if (reqPath === "/health") {
    sendJson(res, { status: "ok", provider: "e2b", authenticated: false });
    return;
  }

  // Auth token endpoint - returns the token (only accessible locally or initially)
  if (reqPath === "/auth-token") {
    // Only allow from localhost or if no token has been retrieved yet
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1") {
      sendJson(res, { token: AUTH_TOKEN });
      return;
    }
    sendJson(res, { error: "Forbidden" }, 403);
    return;
  }

  // /_cmux/auth - Set auth cookie and redirect (like Morph worker)
  if (reqPath === "/_cmux/auth" && req.method === "GET") {
    const token = url.searchParams.get("token");
    const returnPath = url.searchParams.get("return") || "/";

    // Verify the token
    ensureValidToken();
    if (!token || token !== AUTH_TOKEN) {
      sendJson(res, { error: "Invalid token" }, 401);
      return;
    }

    // Set auth cookie and redirect
    setAuthCookie(res, token);
    res.writeHead(302, { Location: returnPath });
    res.end();
    return;
  }

  // All other endpoints require authentication
  if (!verifyAuth(req, url)) {
    sendJson(res, { error: "Unauthorized" }, 401);
    return;
  }

  try {
    let body = {};
    if (req.method === "POST") {
      body = await parseBody(req);
    }

    switch (reqPath) {
      case "/exec": {
        // Execute a command
        if (!body.command) {
          sendJson(res, { error: "command required" }, 400);
          return;
        }
        const result = await execCommand(body.command, body.timeout, body.env);
        sendJson(res, result);
        break;
      }

      case "/read-file": {
        // Read a file
        if (!body.path) {
          sendJson(res, { error: "path required" }, 400);
          return;
        }
        try {
          const content = fs.readFileSync(body.path, "utf-8");
          sendJson(res, { content });
        } catch (e) {
          sendJson(res, { error: e.message }, 404);
        }
        break;
      }

      case "/write-file": {
        // Write a file
        if (!body.path || body.content === undefined) {
          sendJson(res, { error: "path and content required" }, 400);
          return;
        }
        try {
          // Ensure parent directory exists
          const dir = require("path").dirname(body.path);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(body.path, body.content);
          sendJson(res, { success: true });
        } catch (e) {
          sendJson(res, { error: e.message }, 500);
        }
        break;
      }

      case "/list-files": {
        // List files in a directory with metadata for sync
        const dirPath = body.path || "/home/user/workspace";
        const recursive = body.recursive !== false;
        try {
          const files = [];
          const walkDir = (dir, base = "") => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = require("path").join(dir, entry.name);
              const relativePath = require("path").join(base, entry.name);

              // Skip node_modules, .git, etc.
              if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".venv") {
                continue;
              }

              if (entry.isDirectory()) {
                if (recursive) {
                  walkDir(fullPath, relativePath);
                }
              } else if (entry.isFile()) {
                const stat = fs.statSync(fullPath);
                files.push({
                  path: relativePath,
                  size: stat.size,
                  mtime: stat.mtimeMs,
                });
              }
            }
          };
          walkDir(dirPath);
          sendJson(res, { files, basePath: dirPath });
        } catch (e) {
          sendJson(res, { error: e.message }, 500);
        }
        break;
      }

      case "/sync-upload": {
        // Upload multiple files for sync
        // Expects: { basePath: string, files: [{ path: string, content: string }] }
        const basePath = body.basePath || "/home/user/workspace";
        const files = body.files || [];

        if (!Array.isArray(files)) {
          sendJson(res, { error: "files must be an array" }, 400);
          return;
        }

        const results = [];
        for (const file of files) {
          try {
            const fullPath = require("path").join(basePath, file.path);
            const dir = require("path").dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, file.content);
            results.push({ path: file.path, success: true });
          } catch (e) {
            results.push({ path: file.path, success: false, error: e.message });
          }
        }
        sendJson(res, { results, uploaded: results.filter(r => r.success).length });
        break;
      }

      case "/sync-download": {
        // Download multiple files for sync
        // Expects: { basePath: string, paths: string[] }
        const basePath = body.basePath || "/home/user/workspace";
        const paths = body.paths || [];

        if (!Array.isArray(paths)) {
          sendJson(res, { error: "paths must be an array" }, 400);
          return;
        }

        const files = [];
        for (const filePath of paths) {
          try {
            const fullPath = require("path").join(basePath, filePath);
            const content = fs.readFileSync(fullPath, "utf-8");
            const stat = fs.statSync(fullPath);
            files.push({ path: filePath, content, mtime: stat.mtimeMs });
          } catch (e) {
            files.push({ path: filePath, error: e.message });
          }
        }
        sendJson(res, { files });
        break;
      }

      case "/sync-tar": {
        // Fast sync: receive base64-encoded tar.gz and extract to basePath
        // Expects: { basePath: string, tarData: string (base64 encoded tar.gz) }
        const basePath = body.basePath || "/home/user/workspace";
        const tarData = body.tarData;

        if (!tarData) {
          sendJson(res, { error: "tarData required" }, 400);
          return;
        }

        try {
          const zlib = require("zlib");
          const tar = require("tar");
          const path = require("path");

          // Decode base64 to buffer
          const tarBuffer = Buffer.from(tarData, "base64");

          // Decompress gzip
          const decompressed = zlib.gunzipSync(tarBuffer);

          // Write to temp file for extraction
          const tempTarPath = `/tmp/sync-${Date.now()}.tar`;
          fs.writeFileSync(tempTarPath, decompressed);

          // Ensure base path exists
          fs.mkdirSync(basePath, { recursive: true });

          // Extract tar using tar command (more reliable than node tar for all cases)
          const { execSync } = require("child_process");
          execSync(`tar -xf "${tempTarPath}" -C "${basePath}"`, {
            stdio: "pipe",
          });

          // Clean up temp file
          fs.unlinkSync(tempTarPath);

          // Count extracted files
          const countResult = execSync(`find "${basePath}" -type f | wc -l`, {
            encoding: "utf-8",
          });
          const fileCount = parseInt(countResult.trim()) || 0;

          sendJson(res, { success: true, files: fileCount, basePath });
        } catch (e) {
          console.error("[worker-daemon] sync-tar failed:", e.message);
          sendJson(res, { success: false, error: e.message }, 500);
        }
        break;
      }

      case "/delete-file": {
        // Delete a file or directory
        if (!body.path) {
          sendJson(res, { error: "path required" }, 400);
          return;
        }
        try {
          const stat = fs.statSync(body.path);
          if (stat.isDirectory()) {
            fs.rmSync(body.path, { recursive: true });
          } else {
            fs.unlinkSync(body.path);
          }
          sendJson(res, { success: true });
        } catch (e) {
          if (e.code === "ENOENT") {
            sendJson(res, { success: true }); // Already deleted
          } else {
            sendJson(res, { error: e.message }, 500);
          }
        }
        break;
      }

      case "/status": {
        // Get sandbox status
        const processes = await execCommand("ps aux --no-headers | wc -l");
        const memory = await execCommand("free -m | awk '/^Mem:/ {print $3 \"/\" $2}'");
        const disk = await execCommand("df -h / | awk 'NR==2 {print $3 \"/\" $2}'");
        const cdpUrl = await getCdpWebSocketUrl();
        sendJson(res, {
          provider: "e2b",
          processes: parseInt(processes.stdout) || 0,
          memory: memory.stdout,
          disk: disk.stdout,
          cdpAvailable: !!cdpUrl,
          vncAvailable: true,
        });
        break;
      }

      case "/cdp-info": {
        // Get Chrome CDP connection info
        const cdpUrl = await getCdpWebSocketUrl();
        if (!cdpUrl) {
          sendJson(res, { error: "Chrome CDP not available" }, 503);
          return;
        }
        sendJson(res, {
          wsUrl: cdpUrl,
          httpEndpoint: `http://localhost:${CDP_PORT}`,
        });
        break;
      }

      case "/browser-agent": {
        // Run browser agent with prompt
        if (!body.prompt) {
          sendJson(res, { error: "prompt required" }, 400);
          return;
        }
        const result = await runBrowserAgent(body.prompt, {
          timeout: body.timeout,
          screenshotPath: body.screenshotPath,
        });
        sendJson(res, result);
        break;
      }

      case "/screenshot": {
        // Take a screenshot using puppeteer (of the actual active page)
        // Wrap in timeout to prevent hanging forever
        const screenshotTimeoutMs = body.timeout || 15000;
        try {
          const screenshotPromise = (async () => {
            const page = await getActivePage();
            const screenshotBuffer = await page.screenshot({
              type: "png",
              fullPage: false,
            });
            return screenshotBuffer;
          })();

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Screenshot timed out")), screenshotTimeoutMs)
          );

          const screenshotBuffer = await Promise.race([screenshotPromise, timeoutPromise]);
          const imageData = screenshotBuffer.toString("base64");

          // Optionally save to file
          const targetPath = body.path || "/tmp/screenshot.png";
          fs.writeFileSync(targetPath, screenshotBuffer);

          sendJson(res, { success: true, path: targetPath, base64: imageData, data: { base64: imageData } });
        } catch (e) {
          console.error("[worker-daemon] Screenshot failed:", e.message);
          sendJson(res, { error: "Screenshot failed: " + e.message }, 500);
        }
        break;
      }

      case "/services": {
        // List running services
        const vscode = await execCommand("pgrep -f openvscode-server");
        const chrome = await execCommand("pgrep -f 'chrome.*remote-debugging'");
        const vnc = await execCommand("pgrep -f vncserver");
        const novnc = await execCommand("pgrep -f novnc_proxy");

        sendJson(res, {
          vscode: { running: vscode.exit_code === 0, port: 39378 },
          chrome: { running: chrome.exit_code === 0, port: 9222 },
          vnc: { running: vnc.exit_code === 0, port: 5901 },
          novnc: { running: novnc.exit_code === 0, port: 39380 },
          worker: { running: true, port: PORT },
        });
        break;
      }

      // Browser automation commands (matching Morph CLI's computer subcommands)
      case "/snapshot": {
        // Get accessibility tree snapshot
        const result = await execBrowserCommand("snapshot", {});
        sendJson(res, result);
        break;
      }

      case "/open": {
        // Navigate to URL
        if (!body.url) {
          sendJson(res, { error: "url required" }, 400);
          return;
        }
        const result = await execBrowserCommand("open", { url: body.url });
        sendJson(res, result);
        break;
      }

      case "/click": {
        // Click element
        if (!body.selector) {
          sendJson(res, { error: "selector required" }, 400);
          return;
        }
        const result = await execBrowserCommand("click", { selector: body.selector });
        sendJson(res, result);
        break;
      }

      case "/type": {
        // Type text
        if (!body.text) {
          sendJson(res, { error: "text required" }, 400);
          return;
        }
        const result = await execBrowserCommand("type", { text: body.text });
        sendJson(res, result);
        break;
      }

      case "/fill": {
        // Fill input field
        if (!body.selector || body.value === undefined) {
          sendJson(res, { error: "selector and value required" }, 400);
          return;
        }
        const result = await execBrowserCommand("fill", { selector: body.selector, value: body.value });
        sendJson(res, result);
        break;
      }

      case "/press": {
        // Press key
        if (!body.key) {
          sendJson(res, { error: "key required" }, 400);
          return;
        }
        const result = await execBrowserCommand("press", { key: body.key });
        sendJson(res, result);
        break;
      }

      case "/scroll": {
        // Scroll page
        if (!body.direction) {
          sendJson(res, { error: "direction required" }, 400);
          return;
        }
        const result = await execBrowserCommand("scroll", { direction: body.direction });
        sendJson(res, result);
        break;
      }

      case "/back": {
        // Navigate back
        const result = await execBrowserCommand("back", {});
        sendJson(res, result);
        break;
      }

      case "/forward": {
        // Navigate forward
        const result = await execBrowserCommand("forward", {});
        sendJson(res, result);
        break;
      }

      case "/reload": {
        // Reload page
        const result = await execBrowserCommand("reload", {});
        sendJson(res, result);
        break;
      }

      case "/url": {
        // Get current URL
        const result = await execBrowserCommand("url", {});
        sendJson(res, result);
        break;
      }

      case "/title": {
        // Get page title
        const result = await execBrowserCommand("title", {});
        sendJson(res, result);
        break;
      }

      case "/wait": {
        // Wait for element
        if (!body.selector) {
          sendJson(res, { error: "selector required" }, 400);
          return;
        }
        const result = await execBrowserCommand("wait", { selector: body.selector, timeout: body.timeout });
        sendJson(res, result);
        break;
      }

      case "/hover": {
        // Hover over element
        if (!body.selector) {
          sendJson(res, { error: "selector required" }, 400);
          return;
        }
        const result = await execBrowserCommand("hover", { selector: body.selector });
        sendJson(res, result);
        break;
      }

      case "/pty-sessions": {
        // List all active PTY sessions
        const sessions = [];
        for (const [id, session] of ptySessions) {
          sessions.push({
            id,
            createdAt: session.createdAt || Date.now(),
            shell: session.shell || "/bin/bash",
            cwd: session.cwd || "/home/user/workspace",
            connected: session.ws && session.ws.readyState === 1, // WebSocket.OPEN
          });
        }
        sendJson(res, { success: true, sessions });
        break;
      }

      default:
        sendJson(res, { error: "Not found" }, 404);
    }
  } catch (err) {
    console.error("[worker-daemon] Error:", err.message);
    sendJson(res, { success: false, error: err.message }, 500);
  }
}

// Create HTTP server
const server = http.createServer(handleRequest);

// Create WebSocket server for PTY and SSH sessions
// Using noServer mode to handle multiple paths
// IMPORTANT: Disable perMessageDeflate to ensure binary data integrity for SSH
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,  // Disable compression - critical for binary SSH data
});
const net = require("net");

// Track active PTY sessions
// Each session: { pty, ws, createdAt, shell, cwd }
const ptySessions = new Map();

// Handle HTTP upgrade requests for WebSocket
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const token = url.searchParams.get("token") || req.headers.authorization?.replace("Bearer ", "");

  // Verify auth
  ensureValidToken();
  if (!token || token !== AUTH_TOKEN) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  if (pathname === "/pty") {
    // Handle PTY connections
    wss.handleUpgrade(req, socket, head, (ws) => {
      handlePtyConnection(ws, url);
    });
  } else if (pathname === "/ssh") {
    // Handle SSH tunnel connections
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSshConnection(ws, url);
    });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

// Handle SSH tunnel WebSocket connection
function handleSshConnection(ws, url) {
  console.log("[worker-daemon] SSH WebSocket connection established");

  // Buffer incoming WebSocket data until SSH connection is ready
  let sshConnected = false;
  const pendingData = [];

  // Connect to local SSH server on port 10000
  const sshSocket = net.createConnection({ port: 10000, host: "127.0.0.1" }, () => {
    console.log("[worker-daemon] Connected to local SSH server");
    sshConnected = true;

    // Flush any pending data
    for (const data of pendingData) {
      sshSocket.write(data);
    }
    pendingData.length = 0;
  });

  sshSocket.on("error", (err) => {
    console.error("[worker-daemon] SSH socket error:", err.message);
    ws.close(4500, `SSH: ${err.message}`);
  });

  // Forward SSH data to WebSocket (binary)
  sshSocket.on("data", (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  sshSocket.on("close", () => {
    console.log("[worker-daemon] SSH socket closed");
    if (ws.readyState === ws.OPEN) {
      ws.close(1000, "SSH closed");
    }
  });

  // Forward WebSocket data to SSH socket (binary)
  ws.on("message", (msg, isBinary) => {
    if (sshConnected && sshSocket.writable) {
      sshSocket.write(msg);
    } else if (!sshConnected) {
      pendingData.push(msg);
    }
  });

  ws.on("close", () => {
    console.log("[worker-daemon] SSH WebSocket closed");
    sshSocket.destroy();
  });

  ws.on("error", (err) => {
    console.error("[worker-daemon] SSH WebSocket error:", err.message);
    sshSocket.destroy();
  });
}

// Handle PTY WebSocket connection
function handlePtyConnection(ws, url) {
  console.log("[worker-daemon] PTY WebSocket connection established");

  // Parse options from query string
  const cols = parseInt(url.searchParams.get("cols")) || 80;
  const rows = parseInt(url.searchParams.get("rows")) || 24;
  const shell = url.searchParams.get("shell") || process.env.SHELL || "/bin/bash";
  const cwd = url.searchParams.get("cwd") || "/home/user/workspace";

  // Spawn PTY process
  let pty;
  try {
    try {
      const nodePty = require("node-pty");
      pty = nodePty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (e) {
      console.log("[worker-daemon] node-pty not available, using script fallback");
      pty = spawn("script", ["-q", "-c", shell, "/dev/null"], {
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLUMNS: cols.toString(), LINES: rows.toString() },
      });
      pty.resize = () => {};
    }
  } catch (e) {
    console.error("[worker-daemon] Failed to spawn PTY:", e.message);
    ws.close(4500, "Failed to spawn PTY");
    return;
  }

  const sessionId = crypto.randomBytes(8).toString("hex");
  ptySessions.set(sessionId, { pty, ws, createdAt: Date.now(), shell, cwd });

  ws.send(JSON.stringify({ type: "session", id: sessionId }));

  if (pty.onData) {
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });
  } else if (pty.stdout) {
    pty.stdout.on("data", (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });
    pty.stderr.on("data", (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data.toString() }));
      }
    });
  }

  ws.on("message", (msg) => {
    try {
      const message = JSON.parse(msg.toString());
      switch (message.type) {
        case "data":
          if (pty.write) {
            pty.write(message.data);
          } else if (pty.stdin) {
            pty.stdin.write(message.data);
          }
          break;
        case "resize":
          if (pty.resize) {
            pty.resize(message.cols || 80, message.rows || 24);
          }
          break;
      }
    } catch (e) {
      console.error("[worker-daemon] PTY message error:", e.message);
    }
  });

  const onExit = (code) => {
    console.log(`[worker-daemon] PTY exited with code ${code}`);
    ptySessions.delete(sessionId);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code }));
      ws.close();
    }
  };

  if (pty.onExit) {
    pty.onExit(({ exitCode }) => onExit(exitCode));
  } else if (pty.on) {
    pty.on("close", onExit);
    pty.on("exit", onExit);
  }

  ws.on("close", () => {
    console.log("[worker-daemon] PTY WebSocket closed");
    ptySessions.delete(sessionId);
    if (pty.kill) {
      pty.kill();
    } else if (pty.destroy) {
      pty.destroy();
    }
  });
}

// ============================================================
// SSH Server with token-as-username authentication
// This eliminates the need for sshpass on the client side
// ============================================================

const SSH_HOST_KEY_PATH = "/home/user/.ssh/host_key";

/**
 * Generate or load SSH host key
 */
function getHostKey() {
  try {
    // Try to load existing key
    if (fs.existsSync(SSH_HOST_KEY_PATH)) {
      return fs.readFileSync(SSH_HOST_KEY_PATH);
    }
  } catch (e) {
    console.log("[worker-daemon] Generating new SSH host key...");
  }

  // Generate new key using ssh-keygen
  try {
    const { execSync } = require("child_process");
    fs.mkdirSync("/home/user/.ssh", { recursive: true, mode: 0o700 });
    execSync(`ssh-keygen -t ed25519 -f ${SSH_HOST_KEY_PATH} -N "" -q`, {
      stdio: "pipe",
    });
    fs.chmodSync(SSH_HOST_KEY_PATH, 0o600);
    return fs.readFileSync(SSH_HOST_KEY_PATH);
  } catch (e) {
    console.error("[worker-daemon] Failed to generate SSH host key:", e.message);
    // Generate a key in memory using ssh2's utility
    const keyPair = sshUtils.generateKeyPairSync("ed25519");
    return keyPair.private;
  }
}

/**
 * Start SSH server with token-as-username authentication
 * Client connects as: ssh <token>@<host> -p 10000
 * The token IS the username, no password needed.
 * This eliminates the need for sshpass on the client side.
 */
function startSSHServer() {
  const hostKey = getHostKey();

  const sshServer = new SSHServer(
    {
      hostKeys: [hostKey],
    },
    (client) => {
      console.log("[ssh-server] Client connected");

      let authenticatedUser = null;

      client.on("authentication", (ctx) => {
        // The username IS the auth token (like Morph's approach)
        const providedToken = ctx.username;

        // Ensure we have the current valid token
        ensureValidToken();

        if (providedToken === AUTH_TOKEN) {
          authenticatedUser = "user"; // Run as 'user' account
          console.log(`[ssh-server] Token auth successful (method: ${ctx.method})`);
          ctx.accept();
        } else {
          console.log(`[ssh-server] Token auth failed: invalid token`);
          ctx.reject(["none", "password", "publickey"]); // Accept any method, we just check the username
        }
      });

      client.on("ready", () => {
        console.log("[ssh-server] Client authenticated");

        client.on("session", (accept, reject) => {
          const session = accept();

          session.on("pty", (accept, reject, info) => {
            console.log(`[ssh-server] PTY requested: ${info.cols}x${info.rows}`);
            accept();
          });

          session.on("shell", (accept, reject) => {
            console.log("[ssh-server] Shell requested");
            const channel = accept();

            // Spawn shell as the authenticated user
            const shell = spawn("sudo", ["-u", authenticatedUser, "-i"], {
              env: {
                ...process.env,
                TERM: "xterm-256color",
                HOME: `/home/${authenticatedUser}`,
                USER: authenticatedUser,
                SHELL: "/bin/bash",
              },
              cwd: `/home/${authenticatedUser}/workspace`,
            });

            // Pipe data between channel and shell
            channel.pipe(shell.stdin);
            shell.stdout.pipe(channel);
            shell.stderr.pipe(channel.stderr);

            shell.on("close", (code) => {
              console.log(`[ssh-server] Shell exited with code ${code}`);
              channel.exit(code || 0);
              channel.close();
            });

            channel.on("close", () => {
              shell.kill();
            });
          });

          session.on("exec", (accept, reject, info) => {
            console.log(`[ssh-server] Exec: ${info.command}`);
            const channel = accept();

            // Execute command as the authenticated user
            const proc = spawn("sudo", ["-u", authenticatedUser, "-i", "bash", "-c", info.command], {
              env: {
                ...process.env,
                HOME: `/home/${authenticatedUser}`,
                USER: authenticatedUser,
              },
              cwd: `/home/${authenticatedUser}/workspace`,
            });

            // Pipe stdin from channel to process (required for rsync data transfer)
            channel.pipe(proc.stdin);
            proc.stdout.pipe(channel);
            proc.stderr.pipe(channel.stderr);

            // Handle process close - must send exit status before closing channel
            proc.on("close", (code, signal) => {
              const exitCode = code !== null ? code : (signal ? 128 : 0);
              console.log(`[ssh-server] Exec finished with code ${exitCode}`);
              channel.exit(exitCode);
              channel.end();
            });

            // Handle channel close - cleanup process
            channel.on("close", () => {
              if (!proc.killed) {
                proc.kill();
              }
            });

            // Handle channel EOF (client finished sending)
            channel.on("end", () => {
              proc.stdin.end();
            });
          });

          session.on("subsystem", (accept, reject, info) => {
            if (info.name === "sftp") {
              console.log("[ssh-server] SFTP subsystem requested");
              const channel = accept();

              // Use sftp-server for SFTP support
              const sftp = spawn("sudo", ["-u", authenticatedUser, "/usr/lib/openssh/sftp-server"], {
                env: {
                  ...process.env,
                  HOME: `/home/${authenticatedUser}`,
                  USER: authenticatedUser,
                },
              });

              channel.pipe(sftp.stdin);
              sftp.stdout.pipe(channel);

              sftp.on("close", () => {
                channel.close();
              });

              channel.on("close", () => {
                sftp.kill();
              });
            } else {
              reject();
            }
          });
        });
      });

      client.on("close", () => {
        console.log("[ssh-server] Client disconnected");
      });

      client.on("error", (err) => {
        console.error("[ssh-server] Client error:", err.message);
      });
    }
  );

  sshServer.listen(SSH_PORT, "0.0.0.0", () => {
    console.log(`[ssh-server] SSH server listening on port ${SSH_PORT}`);
    console.log(`[ssh-server] Connect with: ssh <token>@<host> -p ${SSH_PORT}`);
  });

  return sshServer;
}

// Start the SSH server
const sshServer = startSSHServer();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[worker-daemon] Listening on port ${PORT}`);
  console.log(`[worker-daemon] Auth token: ${AUTH_TOKEN.substring(0, 8)}...`);
  console.log(`[worker-daemon] PTY WebSocket available at ws://localhost:${PORT}/pty`);
  console.log(`[worker-daemon] SSH WebSocket available at ws://localhost:${PORT}/ssh`);
  console.log(`[worker-daemon] SSH direct: ssh ${AUTH_TOKEN.substring(0, 8)}...@localhost -p ${SSH_PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[worker-daemon] Shutting down...");
  // Close all PTY sessions
  for (const [, session] of ptySessions) {
    if (session.pty.kill) {
      session.pty.kill();
    }
    if (session.ws.close) {
      session.ws.close();
    }
  }
  sshServer.close();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[worker-daemon] Shutting down...");
  sshServer.close();
  server.close(() => process.exit(0));
});
