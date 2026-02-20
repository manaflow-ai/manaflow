#!/bin/bash
# scripts/setup_base_snapshot.sh
# Run this ONCE on a fresh Morph VM to create the reusable base snapshot
#
# This script installs all required software for the cmux devbox development environment:
# - Chrome with CDP for browser automation
# - TigerVNC + XFCE for visual desktop
# - noVNC for web-based VNC access
# - OpenVSCode Server for VS Code in browser
# - Docker for containerized development
# - nginx as reverse proxy
# - Devbox/Nix for package management
#
# Usage:
#   ./setup_base_snapshot.sh
#
# After running, save as snapshot with:
#   morph snapshot create --digest="cmux-base-v1"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${GREEN}=== $1 ===${NC}"
}

echo "=============================================="
echo "    cmux devbox Base Snapshot Setup Script   "
echo "=============================================="
echo ""
echo "Started at: $(date)"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 1/13: System packages
# -----------------------------------------------------------------------------
log_step "Step 1/13: Installing system packages"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl wget git build-essential \
    xfce4 xfce4-goodies dbus-x11 \
    tigervnc-standalone-server \
    nginx \
    python3 python3-pip python3-venv \
    fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
    ca-certificates gnupg lsb-release \
    jq netcat-openbsd \
    sudo openssh-server \
    zsh

log_info "System packages installed"

# -----------------------------------------------------------------------------
# Step 2/13: Install Chrome
# -----------------------------------------------------------------------------
log_step "Step 2/13: Installing Google Chrome"

# Add Google Chrome repository
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

apt-get update
apt-get install -y google-chrome-stable

# Verify Chrome installation
if command -v google-chrome &> /dev/null; then
    CHROME_VERSION=$(google-chrome --version)
    log_info "Chrome installed: $CHROME_VERSION"
else
    log_error "Chrome installation failed"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 3/13: Install Node.js (for agent-browser and other tools)
# -----------------------------------------------------------------------------
log_step "Step 3/13: Installing Node.js"

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verify Node installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
log_info "Node.js installed: $NODE_VERSION"
log_info "npm installed: $NPM_VERSION"

# Install agent-browser globally (Vercel's version)
# It will use the existing Chrome via CDP on port 9222
npm install -g agent-browser || log_warn "agent-browser installation failed"

# Create directory for cmux-worker and its dependencies
mkdir -p /opt/cmux-worker
cd /opt/cmux-worker

# Install node-pty and ws locally for cmux-worker
npm init -y
npm install node-pty ws || log_warn "node-pty/ws installation failed"

cd -

# Install cmux-worker daemon script
cat > /usr/local/bin/cmux-worker << 'WORKER_EOF'
#!/usr/bin/env node
/**
 * cmux devbox Worker Daemon
 *
 * HTTP server that wraps agent-browser commands.
 * Runs on port 39377 (exposed via Morph's worker URL).
 *
 * Authentication:
 * - Validates Stack Auth JWT from Authorization header
 * - Verifies JWT signature using Stack Auth's JWKS
 * - Checks that the user ID in JWT matches the instance owner
 */

const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load modules from /opt/cmux-worker/node_modules
const modulePath = '/opt/cmux-worker/node_modules';
const WebSocket = require(path.join(modulePath, 'ws'));
const pty = require(path.join(modulePath, 'node-pty'));

const PORT = process.env.PORT || 39377;
const OWNER_ID_FILE = '/var/run/cmux/owner-id';
const PROJECT_ID_FILE = '/var/run/cmux/stack-project-id';
const SESSION_SECRET_FILE = '/var/run/cmux/session-secret';

// Auth configuration - loaded at startup
let ownerId = null;
let projectId = null;
let sessionSecret = null;
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour
const SESSION_COOKIE_NAME = 'cmux_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Load auth configuration from files
 */
function loadAuthConfig() {
  try {
    ownerId = fs.readFileSync(OWNER_ID_FILE, 'utf8').trim();
    projectId = fs.readFileSync(PROJECT_ID_FILE, 'utf8').trim();
    console.log(`Auth config loaded: owner=${ownerId}, project=${projectId}`);
  } catch (e) {
    console.error('Warning: Could not load auth config:', e.message);
    console.error('JWT auth will be disabled.');
  }

  // Load or generate session secret for cookie signing
  try {
    sessionSecret = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
  } catch (e) {
    // Generate new session secret
    sessionSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.mkdirSync('/var/run/cmux', { recursive: true });
      fs.writeFileSync(SESSION_SECRET_FILE, sessionSecret);
      console.log('Generated new session secret');
    } catch (writeErr) {
      console.error('Warning: Could not save session secret:', writeErr.message);
    }
  }

  return !!(ownerId && projectId);
}

// =============================================================================
// PTY Session Management
// =============================================================================

// Store active PTY sessions: Map<sessionId, { pty, clients: Set<WebSocket> }>
const ptySessions = new Map();

/**
 * Generate a unique PTY session ID
 */
function generatePtySessionId() {
  return 'pty_' + crypto.randomBytes(8).toString('hex');
}

// Security: Whitelist of allowed shells to prevent command injection
const ALLOWED_SHELLS = new Set(['/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/bash', '/usr/bin/zsh']);

// Security: Allowed base directories for cwd to prevent path traversal
const ALLOWED_CWD_BASES = ['/home/cmux', '/tmp', '/root/workspace'];

/**
 * Validate shell is in whitelist
 */
function validateShell(shell) {
  if (!ALLOWED_SHELLS.has(shell)) {
    console.warn(`Shell "${shell}" not in whitelist, using /bin/bash`);
    return '/bin/bash';
  }
  return shell;
}

/**
 * Validate cwd is within allowed directories to prevent path traversal
 */
function validateCwd(cwd) {
  // Resolve to absolute path and normalize
  const resolved = path.resolve(cwd);

  // Check if path is within any allowed base
  const isAllowed = ALLOWED_CWD_BASES.some(base =>
    resolved === base || resolved.startsWith(base + '/')
  );

  if (!isAllowed) {
    console.warn(`cwd "${cwd}" outside allowed directories, using /home/cmux`);
    return '/home/cmux';
  }
  return resolved;
}

/**
 * Create a new PTY session
 */
function createPtySession(sessionId, options = {}) {
  // Validate shell and cwd to prevent injection/traversal attacks
  const requestedShell = options.shell || process.env.SHELL || '/bin/bash';
  const requestedCwd = options.cwd || process.env.HOME || '/home/cmux';

  const shell = validateShell(requestedShell);
  const cwd = validateCwd(requestedCwd);
  const cols = options.cols || 80;
  const rows = options.rows || 24;
  const env = { ...process.env, ...options.env, TERM: 'xterm-256color' };

  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
  });

  const session = {
    id: sessionId,
    pty: ptyProcess,
    clients: new Set(),
    createdAt: Date.now(),
  };

  ptySessions.set(sessionId, session);
  console.log(`PTY session created: ${sessionId} (shell: ${shell}, cwd: ${cwd})`);

  // Handle PTY output
  ptyProcess.onData((data) => {
    // Broadcast to all connected clients
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'output', data }));
      }
    }
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`PTY session ${sessionId} exited: code=${exitCode}, signal=${signal}`);
    // Notify all clients
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'exit', exitCode, signal }));
        client.close();
      }
    }
    ptySessions.delete(sessionId);
  });

  return session;
}

/**
 * Get an existing PTY session
 */
function getPtySession(sessionId) {
  return ptySessions.get(sessionId);
}

/**
 * Destroy a PTY session
 */
function destroyPtySession(sessionId) {
  const session = ptySessions.get(sessionId);
  if (session) {
    session.pty.kill();
    for (const client of session.clients) {
      client.close();
    }
    ptySessions.delete(sessionId);
    console.log(`PTY session destroyed: ${sessionId}`);
    return true;
  }
  return false;
}

/**
 * List all PTY sessions
 */
function listPtySessions() {
  const sessions = [];
  for (const [id, session] of ptySessions) {
    sessions.push({
      id,
      createdAt: session.createdAt,
      clientCount: session.clients.size,
    });
  }
  return sessions;
}

/**
 * Sign a value for session cookie
 */
function signSession(userId) {
  const data = JSON.stringify({ userId, exp: Date.now() + SESSION_MAX_AGE * 1000 });
  const signature = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
  return Buffer.from(data).toString('base64url') + '.' + signature;
}

/**
 * Verify and decode session cookie
 */
function verifySession(cookie) {
  try {
    const [dataB64, signature] = cookie.split('.');
    const data = Buffer.from(dataB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
    if (signature !== expectedSig) return null;
    const parsed = JSON.parse(data);
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Parse cookies from request
 */
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

/**
 * Generate access denied page HTML
 */
function getAccessDeniedHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Access Denied</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fafafa;
      min-height: 100vh; margin: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    h1 { margin-bottom: 0.5rem; }
    p { color: #888; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Access Denied</h1>
    <p>You don't have permission to view this page.</p>
  </div>
</body>
</html>`;
}

/**
 * Verify one-time login token (signed by CLI)
 * Token format: base64url(JSON{userId, exp}).signature
 */
function verifyLoginToken(token) {
  try {
    const [dataB64, signature] = token.split('.');
    if (!dataB64 || !signature) return null;

    const data = Buffer.from(dataB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

    if (signature !== expectedSig) return null;

    const parsed = JSON.parse(data);
    // Token expires after 24 hours
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (!parsed.userId) return null;

    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch JWKS from Stack Auth
 */
async function fetchJWKS() {
  // Return cached JWKS if still valid
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  const jwksUrl = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`;

  return new Promise((resolve, reject) => {
    https.get(jwksUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          jwksCache = JSON.parse(data);
          jwksCacheTime = Date.now();
          resolve(jwksCache);
        } catch (e) {
          reject(new Error('Failed to parse JWKS'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

/**
 * Verify JWT signature using JWKS
 */
async function verifyJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString());
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString());

  // Check expiration
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('JWT expired');
  }

  // Check issuer
  const expectedIssuer = `https://api.stack-auth.com/api/v1/projects/${projectId}`;
  const anonIssuer = `https://api.stack-auth.com/api/v1/projects-anonymous-users/${projectId}`;
  if (payload.iss !== expectedIssuer && payload.iss !== anonIssuer) {
    throw new Error('Invalid issuer');
  }

  // Fetch JWKS and find matching key
  const jwks = await fetchJWKS();
  const key = jwks.keys.find(k => k.kid === header.kid);
  if (!key) {
    throw new Error('Key not found in JWKS');
  }

  // Verify signature using Node.js crypto
  const signatureData = `${headerB64}.${payloadB64}`;
  const signature = base64UrlDecode(signatureB64);

  // Import the JWK as a crypto key
  const keyObject = crypto.createPublicKey({ key, format: 'jwk' });

  const isValid = crypto.verify(
    'sha256',
    Buffer.from(signatureData),
    { key: keyObject, dsaEncoding: 'ieee-p1363' },
    signature
  );

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return payload;
}

/**
 * Verify authentication - checks JWT and owner ID
 */
async function verifyAuth(req) {
  // If auth config not loaded, deny all requests
  if (!ownerId || !projectId) {
    return { valid: false, error: 'Auth not configured' };
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return { valid: false, error: 'No authorization header' };
  }

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || !token) {
    return { valid: false, error: 'Invalid authorization format' };
  }

  try {
    const payload = await verifyJWT(token);

    // Check if user ID matches owner
    const userId = payload.sub;
    if (userId !== ownerId) {
      return { valid: false, error: 'User is not the instance owner' };
    }

    return { valid: true, userId };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Load auth config at startup
loadAuthConfig();

/**
 * Run an agent-browser command and return the result
 * Uses CDP to connect to the existing Chrome on port 9222
 */
async function runAgentBrowser(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('agent-browser', [...args, '--cdp', '9222', '--json'], {
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Exit code ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          resolve({ success: true, data: stdout });
        }
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Proxy request to nginx (port 80)
 * Used for VS Code, VNC, and other browser-accessible services
 */
function proxyToNginx(req, res, originalHost) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 80,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      // Keep original host for proper redirects
      host: originalHost || req.headers.host || 'localhost',
    },
  }, (proxyRes) => {
    // Rewrite Location header if it points to localhost
    const headers = { ...proxyRes.headers };
    if (headers.location && originalHost) {
      headers.location = headers.location
        .replace(/^http:\/\/localhost(:\d+)?/i, `https://${originalHost}`)
        .replace(/^http:\/\/127\.0\.0\.1(:\d+)?/i, `https://${originalHost}`);
    }
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

/**
 * Check if path should be proxied to nginx (browser access)
 */
function isBrowserPath(pathname) {
  // Root path serves VS Code
  if (pathname === '/') return true;
  // VS Code paths
  if (pathname.startsWith('/code')) return true;
  // VNC paths
  if (pathname.startsWith('/vnc')) return true;
  // WebSocket for VNC
  if (pathname.startsWith('/websockify')) return true;
  // Static assets from VS Code
  if (pathname.startsWith('/static')) return true;
  if (pathname.startsWith('/stable')) return true;
  if (pathname.startsWith('/vscode')) return true;
  // VS Code internal paths (but not our /_cmux/ endpoints)
  if (pathname.startsWith('/_') && !pathname.startsWith('/_cmux')) return true;
  // Favicon, manifest, etc.
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/manifest.json') return true;
  return false;
}

/**
 * Handle requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  // Health check - no auth
  if (reqPath === '/health') {
    sendJson(res, { status: 'ok' });
    return;
  }

  // Auth endpoint - CLI generates URL with signed token, sets session cookie
  // URL format: /_cmux/auth?token=xxx&return=/code/
  if (reqPath === '/_cmux/auth') {
    const token = url.searchParams.get('token');
    const returnTo = url.searchParams.get('return') || '/code/';

    if (!token) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Verify the one-time login token
    const tokenData = verifyLoginToken(token);
    if (!tokenData) {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Check user is the instance owner
    if (tokenData.userId !== ownerId) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Create session cookie and redirect
    // Note: Secure flag ensures cookie only sent over HTTPS
    const sessionValue = signSession(tokenData.userId);
    res.writeHead(302, {
      'Location': returnTo,
      'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
    });
    res.end();
    return;
  }

  // Browser paths (VS Code, VNC) - require session cookie
  if (isBrowserPath(reqPath)) {
    const cookies = parseCookies(req);
    const session = cookies[SESSION_COOKIE_NAME] ? verifySession(cookies[SESSION_COOKIE_NAME]) : null;

    if (!session || session.userId !== ownerId) {
      // No valid session - show access denied page
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Valid session - proxy to nginx
    proxyToNginx(req, res, req.headers.host);
    return;
  }

  // CORS headers for API endpoints
  // Use origin whitelist instead of wildcard for better security
  const ALLOWED_ORIGINS = [
    'https://cmux.sh',
    'https://www.cmux.sh',
    'https://staging.cmux.sh',
    'https://manaflow.com',
    'https://www.manaflow.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const requestOrigin = req.headers.origin;
  const allowedOrigin = requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints require JWT authentication
  const authResult = await verifyAuth(req);
  if (!authResult.valid) {
    sendJson(res, { error: 'Unauthorized', message: authResult.error || 'Authentication required' }, 401);
    return;
  }

  try {
    let result;
    let body = {};

    if (req.method === 'POST') {
      body = await parseBody(req);
    }

    switch (reqPath) {

      // Generate one-time auth token for browser access (CLI calls this)
      case '/_cmux/generate-token':
        const tokenData = {
          userId: ownerId,
          exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        };
        const tokenJson = JSON.stringify(tokenData);
        const tokenB64 = Buffer.from(tokenJson).toString('base64url');
        const tokenSig = crypto.createHmac('sha256', sessionSecret).update(tokenJson).digest('base64url');
        result = { token: `${tokenB64}.${tokenSig}` };
        break;

      case '/snapshot':
        const snapshotArgs = ['snapshot'];
        if (body.interactive) snapshotArgs.push('-i');
        if (body.compact) snapshotArgs.push('-c');
        result = await runAgentBrowser(snapshotArgs);
        break;

      case '/open':
        if (!body.url) {
          sendJson(res, { error: 'url required' }, 400);
          return;
        }
        result = await runAgentBrowser(['open', body.url]);
        break;

      case '/click':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['click', body.selector]);
        break;

      case '/dblclick':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['dblclick', body.selector]);
        break;

      case '/type':
        if (!body.text) {
          sendJson(res, { error: 'text required' }, 400);
          return;
        }
        result = await runAgentBrowser(['type', body.selector || '', body.text]);
        break;

      case '/fill':
        if (!body.selector || body.value === undefined) {
          sendJson(res, { error: 'selector and value required' }, 400);
          return;
        }
        result = await runAgentBrowser(['fill', body.selector, body.value]);
        break;

      case '/press':
        if (!body.key) {
          sendJson(res, { error: 'key required' }, 400);
          return;
        }
        result = await runAgentBrowser(['press', body.key]);
        break;

      case '/hover':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['hover', body.selector]);
        break;

      case '/scroll':
        const dir = body.direction || 'down';
        const amount = body.amount ? String(body.amount) : undefined;
        const scrollArgs = ['scroll', dir];
        if (amount) scrollArgs.push(amount);
        result = await runAgentBrowser(scrollArgs);
        break;

      case '/screenshot':
        // Take screenshot and return base64
        const ssResult = await runAgentBrowser(['screenshot']);
        if (ssResult.success && ssResult.data && ssResult.data.path) {
          const imgData = fs.readFileSync(ssResult.data.path);
          const base64 = imgData.toString('base64');
          result = { success: true, data: { base64 } };
          // Clean up temp file
          try { fs.unlinkSync(ssResult.data.path); } catch (e) {}
        } else {
          result = ssResult;
        }
        break;

      case '/back':
        result = await runAgentBrowser(['back']);
        break;

      case '/forward':
        result = await runAgentBrowser(['forward']);
        break;

      case '/reload':
        result = await runAgentBrowser(['reload']);
        break;

      case '/url':
        result = await runAgentBrowser(['get', 'url']);
        break;

      case '/title':
        result = await runAgentBrowser(['get', 'title']);
        break;

      case '/wait':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['wait', body.selector]);
        break;

      case '/eval':
        if (!body.script) {
          sendJson(res, { error: 'script required' }, 400);
          return;
        }
        result = await runAgentBrowser(['eval', body.script]);
        break;

      // =====================================================================
      // PTY Endpoints
      // =====================================================================

      case '/_cmux/pty/create':
        // Create a new PTY session
        const ptySessionId = generatePtySessionId();
        const ptySession = createPtySession(ptySessionId, {
          shell: body.shell,
          cwd: body.cwd,
          cols: body.cols,
          rows: body.rows,
          env: body.env,
        });
        sendJson(res, {
          success: true,
          sessionId: ptySession.id,
          createdAt: ptySession.createdAt,
        });
        return;

      case '/_cmux/pty/list':
        // List all PTY sessions
        sendJson(res, {
          success: true,
          sessions: listPtySessions(),
        });
        return;

      case '/_cmux/pty/destroy':
        // Destroy a PTY session
        if (!body.sessionId) {
          sendJson(res, { error: 'sessionId required' }, 400);
          return;
        }
        const destroyed = destroyPtySession(body.sessionId);
        sendJson(res, { success: destroyed });
        return;

      case '/_cmux/pty/resize':
        // Resize a PTY session
        if (!body.sessionId || !body.cols || !body.rows) {
          sendJson(res, { error: 'sessionId, cols, and rows required' }, 400);
          return;
        }
        const resizeSession = getPtySession(body.sessionId);
        if (!resizeSession) {
          sendJson(res, { error: 'Session not found' }, 404);
          return;
        }
        resizeSession.pty.resize(body.cols, body.rows);
        sendJson(res, { success: true });
        return;

      case '/_cmux/pty/write':
        // Write to a PTY session (for non-WebSocket clients)
        if (!body.sessionId || body.data === undefined) {
          sendJson(res, { error: 'sessionId and data required' }, 400);
          return;
        }
        const writeSession = getPtySession(body.sessionId);
        if (!writeSession) {
          sendJson(res, { error: 'Session not found' }, 404);
          return;
        }
        writeSession.pty.write(body.data);
        sendJson(res, { success: true });
        return;

      default:
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    sendJson(res, result);
  } catch (err) {
    console.error('Error:', err.message);
    sendJson(res, { success: false, error: err.message }, 500);
  }
}

const server = http.createServer(handleRequest);

// =============================================================================
// WebSocket Server for PTY
// =============================================================================

const wss = new WebSocket.Server({ noServer: true });

/**
 * Authenticate WebSocket connection
 * Supports both session cookie (browser) and JWT (API)
 */
async function authenticateWebSocket(req) {
  // Try session cookie first (for browser connections)
  const cookies = parseCookies(req);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (sessionCookie) {
    const session = verifySession(sessionCookie);
    if (session && session.userId === ownerId) {
      return { valid: true, userId: session.userId, method: 'session' };
    }
  }

  // Try JWT from query parameter (for programmatic connections)
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  if (token) {
    // Verify one-time login token
    const tokenData = verifyLoginToken(token);
    if (tokenData && tokenData.userId === ownerId) {
      return { valid: true, userId: tokenData.userId, method: 'token' };
    }
  }

  // Try Authorization header
  const authResult = await verifyAuth(req);
  if (authResult.valid) {
    return { valid: true, userId: authResult.userId, method: 'jwt' };
  }

  return { valid: false, error: 'Unauthorized' };
}

/**
 * Proxy WebSocket upgrade to nginx for browser paths (VNC, VS Code)
 */
function proxyWebSocketToNginx(req, socket, head) {
  const proxySocket = net.connect(80, '127.0.0.1', () => {
    // Forward the upgrade request to nginx
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    const upgradeRequest = `${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`;
    proxySocket.write(upgradeRequest);
    if (head && head.length > 0) {
      proxySocket.write(head);
    }
    // Pipe data bidirectionally
    socket.pipe(proxySocket);
    proxySocket.pipe(socket);
  });

  proxySocket.on('error', (err) => {
    console.error('WebSocket proxy error:', err.message);
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.error('Client socket error:', err.message);
    proxySocket.destroy();
  });

  socket.on('close', () => proxySocket.destroy());
  proxySocket.on('close', () => socket.destroy());
}

/**
 * Handle WebSocket upgrade for PTY connections and browser paths
 */
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Handle browser path WebSocket upgrades (VNC, VS Code)
  if (isBrowserPath(pathname)) {
    // Check session cookie for authentication
    const cookies = parseCookies(req);
    const session = cookies[SESSION_COOKIE_NAME] ? verifySession(cookies[SESSION_COOKIE_NAME]) : null;

    if (!session || session.userId !== ownerId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Proxy WebSocket to nginx
    proxyWebSocketToNginx(req, socket, head);
    return;
  }

  // Handle PTY WebSocket connections
  if (!pathname.startsWith('/_cmux/pty/ws/')) {
    socket.destroy();
    return;
  }

  // Authenticate the connection
  const auth = await authenticateWebSocket(req);
  if (!auth.valid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Extract session ID from path: /_cmux/pty/ws/{sessionId}
  const sessionId = pathname.replace('/_cmux/pty/ws/', '');

  // Get or create the PTY session
  let session = getPtySession(sessionId);

  // If sessionId is 'new', create a new session
  if (sessionId === 'new' || !session) {
    const newSessionId = sessionId === 'new' ? generatePtySessionId() : sessionId;
    const cols = parseInt(url.searchParams.get('cols')) || 80;
    const rows = parseInt(url.searchParams.get('rows')) || 24;
    const cwd = url.searchParams.get('cwd') || undefined;
    const shell = url.searchParams.get('shell') || undefined;

    session = createPtySession(newSessionId, { cols, rows, cwd, shell });
  }

  // Complete WebSocket upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    // Add client to session
    session.clients.add(ws);
    console.log(`WebSocket client connected to PTY ${session.id} (total: ${session.clients.size})`);

    // Send session info
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId: session.id,
    }));

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        switch (msg.type) {
          case 'input':
            // Write input to PTY
            session.pty.write(msg.data);
            break;
          case 'resize':
            // Resize PTY
            if (msg.cols && msg.rows) {
              session.pty.resize(msg.cols, msg.rows);
            }
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (e) {
        // If not JSON, treat as raw input
        session.pty.write(message.toString());
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      session.clients.delete(ws);
      console.log(`WebSocket client disconnected from PTY ${session.id} (remaining: ${session.clients.size})`);

      // Optionally destroy session when last client disconnects
      // Uncomment to enable auto-destroy:
      // if (session.clients.size === 0) {
      //   destroyPtySession(session.id);
      // }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for PTY ${session.id}:`, err.message);
      session.clients.delete(ws);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`cmux devbox Worker daemon listening on port ${PORT}`);
  console.log(`PTY WebSocket endpoint: ws://localhost:${PORT}/_cmux/pty/ws/{sessionId}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  // Close all PTY sessions
  for (const [id, session] of ptySessions) {
    destroyPtySession(id);
  }
  wss.close();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  for (const [id, session] of ptySessions) {
    destroyPtySession(id);
  }
  wss.close();
  server.close(() => process.exit(0));
});
WORKER_EOF

chmod +x /usr/local/bin/cmux-worker
log_info "Installed cmux devbox worker daemon"

# Create token directory
mkdir -p /var/run/cmux

# -----------------------------------------------------------------------------
# Step 4/13: Install Docker
# -----------------------------------------------------------------------------
log_step "Step 4/13: Installing Docker"

# Detect OS (Ubuntu or Debian)
. /etc/os-release
DOCKER_OS="$ID"
log_info "Detected OS: $DOCKER_OS ($VERSION_CODENAME)"

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/$DOCKER_OS/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$DOCKER_OS \
  $VERSION_CODENAME stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update

# Install Docker packages
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Verify Docker installation
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    log_info "Docker installed: $DOCKER_VERSION"
else
    log_error "Docker installation failed"
    exit 1
fi

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Verify Docker is running
if docker info &>/dev/null; then
    log_info "Docker daemon is running"
else
    log_warn "Docker daemon may not be running yet"
fi

log_info "Docker installation complete"

# -----------------------------------------------------------------------------
# Step 5/13: Install Devbox
# -----------------------------------------------------------------------------
log_step "Step 5/13: Installing Devbox"

curl -fsSL https://get.jetify.com/devbox | bash -s -- -f

# Verify Devbox installation
if command -v devbox &> /dev/null; then
    DEVBOX_VERSION=$(devbox version 2>/dev/null || echo "installed")
    log_info "Devbox installed: $DEVBOX_VERSION"
else
    log_warn "Devbox installation may require shell restart"
fi

# -----------------------------------------------------------------------------
# Step 6/13: Install OpenVSCode Server (works directly in browser, no PWA prompt)
# -----------------------------------------------------------------------------
log_step "Step 6/13: Installing OpenVSCode Server"

# Get latest release version
CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest | jq -r '.tag_name' | sed 's|^openvscode-server-v||')"
log_info "Installing OpenVSCode Server version: $CODE_RELEASE"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64) ARCH="arm64" ;;
    *) log_error "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Download and install
mkdir -p /app/openvscode-server
url="https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${CODE_RELEASE}/openvscode-server-v${CODE_RELEASE}-linux-${ARCH}.tar.gz"
log_info "Downloading from: $url"
curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}"
tar xf /tmp/openvscode-server.tar.gz -C /app/openvscode-server --strip-components=1
rm -f /tmp/openvscode-server.tar.gz

# Create user data directory
# Note: cmux user may not exist yet, but we create the directory structure
# and will fix ownership in Step 11
mkdir -p /home/cmux/.openvscode-server/data/User
mkdir -p /home/cmux/.openvscode-server/data/User/profiles/default-profile
mkdir -p /home/cmux/.openvscode-server/data/Machine
mkdir -p /home/cmux/.openvscode-server/extensions

# Create configure-openvscode script
cat > /usr/local/bin/configure-openvscode << 'CONFIGURE_EOF'
#!/usr/bin/env bash
set -euo pipefail

home="${HOME:-/home/cmux}"
user_base="${home}/.openvscode-server"
user_dir="${user_base}/data/User"
default_profile_dir="${user_base}/data/User/profiles/default-profile"
machine_dir="${user_base}/data/Machine"

mkdir -p "${user_dir}" "${default_profile_dir}" "${machine_dir}"

# Base settings for terminal and workspace
BASE_SETTINGS=$(cat << 'SETTINGSJSON'
{
    "workbench.colorTheme": "Default Dark Modern",
    "workbench.startupEditor": "none",
    "workbench.welcomePage.walkthroughs.openOnInstall": false,
    "workbench.tips.enabled": false,
    "workbench.secondarySideBar.visible": false,
    "workbench.activityBar.visible": true,
    "workbench.sideBar.location": "left",
    "editor.fontSize": 14,
    "editor.tabSize": 2,
    "editor.minimap.enabled": false,
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 1000,
    "terminal.integrated.fontSize": 14,
    "terminal.integrated.shellIntegration.enabled": false,
    "terminal.integrated.showTerminalConfigPrompt": false,
    "terminal.integrated.defaultProfile.linux": "zsh",
    "terminal.integrated.profiles.linux": {
        "zsh": {
            "path": "/usr/bin/zsh",
            "args": ["-l"]
        },
        "bash": {
            "path": "/bin/bash",
            "args": ["-l"]
        }
    },
    "security.workspace.trust.enabled": false,
    "security.workspace.trust.startupPrompt": "never",
    "security.workspace.trust.untrustedFiles": "open",
    "security.workspace.trust.emptyWindow": false,
    "git.openDiffOnClick": true,
    "scm.defaultViewMode": "tree",
    "chat.commandCenter.enabled": false,
    "github.copilot.enable": {}
}
SETTINGSJSON
)

# Write settings to all required locations
for settings_file in "${user_dir}/settings.json" "${default_profile_dir}/settings.json" "${machine_dir}/settings.json"; do
    echo "$BASE_SETTINGS" > "$settings_file"
done

# Ensure workspace state directories exist
mkdir -p "${user_base}/data/User/workspaceStorage"
mkdir -p "${user_base}/data/User/globalStorage"
CONFIGURE_EOF

chmod +x /usr/local/bin/configure-openvscode
log_info "Created configure-openvscode script"

# Verify installation
if [ -x /app/openvscode-server/bin/openvscode-server ]; then
    log_info "OpenVSCode Server installed to /app/openvscode-server"
else
    log_error "OpenVSCode Server installation failed"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 7/13: Install noVNC
# -----------------------------------------------------------------------------
log_step "Step 7/13: Installing noVNC"

git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC
git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify

# Make noVNC launch script executable
chmod +x /opt/noVNC/utils/novnc_proxy

log_info "noVNC installed to /opt/noVNC"

# -----------------------------------------------------------------------------
# Step 8/13: Create cmux user
# -----------------------------------------------------------------------------
log_step "Step 8/13: Creating cmux user"

# Create user if doesn't exist
if ! id "cmux" &>/dev/null; then
    useradd -m -s /usr/bin/zsh cmux
    log_info "Created user 'cmux'"
else
    log_info "User 'cmux' already exists"
    # Update shell to zsh if not already set
    chsh -s /usr/bin/zsh cmux 2>/dev/null || true
fi

# Create basic zsh config
cat > /home/cmux/.zshrc << 'ZSHRC_EOF'
# Basic zsh configuration
export TERM=xterm-256color
export EDITOR=nano
export PATH="$HOME/.local/bin:$PATH"

# History
HISTSIZE=10000
SAVEHIST=10000
HISTFILE=~/.zsh_history
setopt SHARE_HISTORY
setopt HIST_IGNORE_DUPS

# Prompt
PS1='%F{green}%n@%m%f:%F{blue}%~%f$ '

# Aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
ZSHRC_EOF
chown cmux:cmux /home/cmux/.zshrc

# Add to sudoers
echo "cmux ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/cmux
chmod 440 /etc/sudoers.d/cmux

# Add cmux user to docker group
usermod -aG docker cmux
log_info "User 'cmux' added to docker group"

log_info "User 'cmux' configured with sudo access"

# -----------------------------------------------------------------------------
# Step 9/13: Configure VNC
# -----------------------------------------------------------------------------
log_step "Step 9/13: Configuring VNC"

# Create VNC directory
mkdir -p /home/cmux/.vnc

# Create VNC startup script for XFCE
cat > /home/cmux/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11

# Start D-Bus
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
    eval $(dbus-launch --sh-syntax)
    export DBUS_SESSION_BUS_ADDRESS
fi

# Start XFCE
exec startxfce4
EOF

chmod +x /home/cmux/.vnc/xstartup
chown -R cmux:cmux /home/cmux/.vnc

# Create XFCE autostart for Chrome browser (visible in VNC desktop)
# Flags prevent restore pages dialog and other session-related popups
mkdir -p /home/cmux/.config/autostart
cat > /home/cmux/.config/autostart/chrome-browser.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Google Chrome
Exec=/usr/bin/google-chrome --no-first-run --no-default-browser-check --start-maximized --disable-session-crashed-bubble --disable-infobars --hide-crash-restore-bubble
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
EOF
chown -R cmux:cmux /home/cmux/.config

# Create Chrome preferences to disable session restore
mkdir -p /home/cmux/.config/google-chrome/Default
cat > /home/cmux/.config/google-chrome/Default/Preferences << 'CHROME_PREFS_EOF'
{
  "session": {
    "restore_on_startup": 5
  },
  "profile": {
    "exit_type": "Normal"
  },
  "browser": {
    "has_seen_welcome_page": true
  }
}
CHROME_PREFS_EOF
chown -R cmux:cmux /home/cmux/.config/google-chrome

log_info "VNC configured with Chrome autostart (session restore disabled)"

# -----------------------------------------------------------------------------
# Step 10/13: Create systemd services
# -----------------------------------------------------------------------------
log_step "Step 10/13: Creating systemd services"

# VNC Server service
cat > /etc/systemd/system/vncserver.service << 'EOF'
[Unit]
Description=TigerVNC Server for cmux devbox
After=network.target

[Service]
Type=simple
User=cmux
Group=cmux
Environment=DISPLAY=:1
Environment=HOME=/home/cmux

# Kill any existing VNC server on display :1
ExecStartPre=-/usr/bin/vncserver -kill :1
ExecStartPre=/bin/sleep 1

# Start Xvnc directly
ExecStart=/usr/bin/Xvnc :1 \
    -geometry 1920x1080 \
    -depth 24 \
    -rfbport 5901 \
    -SecurityTypes None \
    -localhost no \
    -AlwaysShared \
    -AcceptKeyEvents \
    -AcceptPointerEvents \
    -SendCutText \
    -AcceptCutText

ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created vncserver.service"

# XFCE Session service
cat > /etc/systemd/system/xfce-session.service << 'EOF'
[Unit]
Description=XFCE Desktop Session
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
User=cmux
Group=cmux
Environment=DISPLAY=:1
Environment=HOME=/home/cmux
Environment=XDG_SESSION_TYPE=x11

# Wait for VNC to be ready
ExecStartPre=/bin/bash -c 'for i in {1..30}; do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.5; done'

# Start XFCE
ExecStart=/usr/bin/startxfce4

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created xfce-session.service"

# Chrome with CDP service
cat > /etc/systemd/system/chrome-cdp.service << 'EOF'
[Unit]
Description=Chrome with Chrome DevTools Protocol
After=xfce-session.service
Requires=xfce-session.service

[Service]
Type=simple
User=cmux
Group=cmux
Environment=DISPLAY=:1
Environment=HOME=/home/cmux

# Wait for XFCE to be ready
ExecStartPre=/bin/bash -c 'for i in {1..60}; do pgrep -u cmux xfwm4 > /dev/null && break; sleep 0.5; done'
ExecStartPre=/bin/sleep 2

ExecStart=/usr/bin/google-chrome \
    --headless=new \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --disable-software-rasterizer \
    --window-size=1920,1080 \
    --no-first-run \
    --no-default-browser-check \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --disable-background-networking \
    --disable-client-side-phishing-detection \
    --disable-component-update \
    --disable-hang-monitor \
    --disable-popup-blocking \
    --disable-prompt-on-repost \
    --metrics-recording-only \
    --safebrowsing-disable-auto-update \
    --password-store=basic \
    --use-mock-keychain \
    --user-data-dir=/home/cmux/.chrome-cmux \
    about:blank

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

log_info "Created chrome-cdp.service"

# noVNC service
cat > /etc/systemd/system/novnc.service << 'EOF'
[Unit]
Description=noVNC Web VNC Client
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
Environment=HOME=/root

# Wait for VNC to be ready
ExecStartPre=/bin/bash -c 'for i in {1..30}; do nc -z localhost 5901 && break; sleep 0.5; done'

ExecStart=/opt/noVNC/utils/novnc_proxy \
    --vnc localhost:5901 \
    --listen 6080

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created novnc.service"

# OpenVSCode Server service
cat > /etc/systemd/system/openvscode.service << 'EOF'
[Unit]
Description=OpenVSCode Server IDE
After=network.target

[Service]
Type=simple
User=cmux
Group=cmux
Environment=HOME=/home/cmux
Environment=SHELL=/usr/bin/zsh
WorkingDirectory=/home/cmux

ExecStartPre=/usr/local/bin/configure-openvscode
ExecStart=/app/openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 10080 \
    --server-base-path=/code/ \
    --without-connection-token \
    --disable-workspace-trust \
    --server-data-dir /home/cmux/.openvscode-server/data \
    --user-data-dir /home/cmux/.openvscode-server/data \
    --extensions-dir /home/cmux/.openvscode-server/extensions \
    /home/cmux/workspace

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created openvscode.service"

# cmux-worker service (browser automation API)
cat > /etc/systemd/system/cmux-worker.service << 'EOF'
[Unit]
Description=cmux devbox Worker Daemon (Browser Automation API)
After=chrome-cdp.service
Requires=chrome-cdp.service

[Service]
Type=simple
Environment=PORT=39377
Environment=PATH=/usr/local/bin:/usr/bin:/bin
WorkingDirectory=/home/cmux

ExecStart=/usr/bin/node /usr/local/bin/cmux-worker

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created cmux-worker.service"

# Reload systemd
systemctl daemon-reload

# -----------------------------------------------------------------------------
# Step 11/13: Configure nginx
# -----------------------------------------------------------------------------
log_step "Step 11/13: Configuring nginx"

cat > /etc/nginx/sites-available/cmux << 'EOF'
# cmux devbox nginx configuration
# Routes all services through port 80

upstream code_server {
    server 127.0.0.1:10080;
}

upstream app_server {
    server 127.0.0.1:10000;
}

upstream novnc {
    server 127.0.0.1:6080;
}

upstream chrome_cdp {
    server 127.0.0.1:9222;
}

server {
    listen 80 default_server;
    server_name _;

    # Increase timeouts for WebSocket connections
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;

    # OpenVSCode Server (VS Code IDE)
    location /code/ {
        proxy_pass http://code_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept-Encoding gzip;
    }

    # App (developer's application on port 10000)
    location /app/ {
        proxy_pass http://app_server/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # noVNC (web-based VNC)
    location /vnc/ {
        proxy_pass http://novnc/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # noVNC websocket connection
    location /websockify {
        proxy_pass http://novnc/websockify;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Chrome DevTools Protocol (for agent-browser)
    location /cdp/ {
        proxy_pass http://chrome_cdp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host localhost;
    }

    # CDP JSON endpoints
    location /json {
        proxy_pass http://chrome_cdp/json;
        proxy_http_version 1.1;
        proxy_set_header Host localhost;
    }

    # DevTools WebSocket
    location ~ ^/devtools/.*$ {
        proxy_pass http://chrome_cdp;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host localhost;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 'cmux devbox VM is healthy\n';
        add_header Content-Type text/plain;
    }

    # Root - redirect to VNC by default
    location = / {
        return 302 /vnc/;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/cmux /etc/nginx/sites-enabled/cmux

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

log_info "nginx configured"

# -----------------------------------------------------------------------------
# Step 12/13: Create workspace directory and final setup
# -----------------------------------------------------------------------------
log_step "Step 12/13: Final setup"

# Create workspace directory
mkdir -p /home/cmux/workspace
mkdir -p /home/cmux/.chrome-cmux
mkdir -p /home/cmux/.openvscode-server/extensions
# Fix ownership of entire home directory (some files may have been created as root)
chown -R cmux:cmux /home/cmux

# Run configure-openvscode to set up initial settings (now that ownership is correct)
sudo -u cmux HOME=/home/cmux /usr/local/bin/configure-openvscode
log_info "Configured OpenVSCode settings for cmux user"

# Create a welcome file in workspace
cat > /home/cmux/workspace/README.md << 'EOF'
# cmux devbox Workspace

This is your development workspace in the Morph Cloud VM.

## Quick Links

- VS Code: http://localhost/code/
- VNC: http://localhost/vnc/
- Your App: http://localhost/app/ (when running)

## Getting Started

1. Clone your repository here
2. Use `devbox init` to set up your development environment
3. Start your dev server on port 10000

## Docker

Docker and Docker Compose are pre-installed:
```bash
docker --version
docker compose --version
```

Run containerized services:
```bash
docker run -d -p 5432:5432 postgres
docker compose up -d
```

## Port Mappings

| Service | Port |
|---------|------|
| Your App | 10000 |
| OpenVSCode | 10080 |
| Chrome CDP | 9222 |
| VNC | 5901 |
| noVNC | 6080 |
| nginx | 80 |

EOF
chown cmux:cmux /home/cmux/workspace/README.md

# Enable services
systemctl enable vncserver
systemctl enable xfce-session
systemctl enable chrome-cdp
systemctl enable novnc
systemctl enable openvscode
systemctl enable nginx
systemctl enable cmux-worker

log_info "Services enabled"

# -----------------------------------------------------------------------------
# Step 13/13: Start services and verify
# -----------------------------------------------------------------------------
log_step "Step 13/13: Starting and verifying services"

# Start services in order with proper wait times
log_info "Starting nginx..."
systemctl start nginx
log_info "Started nginx"

log_info "Starting VNC server..."
systemctl start vncserver
# Wait for X11 socket to appear
for i in {1..30}; do
    [ -e /tmp/.X11-unix/X1 ] && break
    sleep 1
done
log_info "Started vncserver"

log_info "Starting XFCE session..."
systemctl start xfce-session
# Wait for XFCE window manager to start
for i in {1..60}; do
    pgrep -u cmux xfwm4 > /dev/null && break
    sleep 1
done
sleep 3
log_info "Started xfce-session"

log_info "Starting noVNC..."
systemctl start novnc
log_info "Started novnc"

log_info "Starting OpenVSCode Server..."
systemctl start openvscode
log_info "Started openvscode"

log_info "Starting Chrome CDP..."
systemctl start chrome-cdp
# Wait for Chrome to be ready
for i in {1..30}; do
    curl -s http://localhost:9222/json/version > /dev/null 2>&1 && break
    sleep 1
done
log_info "Started chrome-cdp"

log_info "Starting cmux-worker..."
systemctl start cmux-worker
log_info "Started cmux-worker"

# Final stabilization wait
log_info "Waiting for services to stabilize..."
sleep 5

# Clean Chrome session state to prevent "restore pages" dialog on next boot
log_info "Cleaning Chrome session state..."
# Stop visible Chrome processes (not headless CDP)
pkill -f "google-chrome.*--start-maximized" || true
sleep 2
# Remove session files that cause restore prompts
rm -f /home/cmux/.config/google-chrome/Default/Current\ Session 2>/dev/null || true
rm -f /home/cmux/.config/google-chrome/Default/Current\ Tabs 2>/dev/null || true
rm -f /home/cmux/.config/google-chrome/Default/Last\ Session 2>/dev/null || true
rm -f /home/cmux/.config/google-chrome/Default/Last\ Tabs 2>/dev/null || true
rm -rf /home/cmux/.config/google-chrome/Default/Sessions 2>/dev/null || true
# Ensure exit_type is Normal
if [ -f /home/cmux/.config/google-chrome/Default/Preferences ]; then
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' /home/cmux/.config/google-chrome/Default/Preferences 2>/dev/null || true
fi
log_info "Chrome session state cleaned"

# -----------------------------------------------------------------------------
# Verification
# -----------------------------------------------------------------------------
echo ""
echo "=============================================="
echo "              VERIFICATION                    "
echo "=============================================="
echo ""

FAILED=0

check_service() {
    local name=$1
    if systemctl is-active --quiet "$name"; then
        echo -e "${GREEN}[OK]${NC} $name is running"
    else
        echo -e "${RED}[FAIL]${NC} $name is NOT running"
        FAILED=1
    fi
}

check_port() {
    local port=$1
    local name=$2
    if nc -z localhost "$port" 2>/dev/null; then
        echo -e "${GREEN}[OK]${NC} $name (port $port) is listening"
    else
        echo -e "${RED}[FAIL]${NC} $name (port $port) is NOT listening"
        FAILED=1
    fi
}

# Check systemd services
check_service "vncserver"
check_service "xfce-session"
check_service "chrome-cdp"
check_service "novnc"
check_service "openvscode"
check_service "nginx"
check_service "docker"
check_service "cmux-worker"

echo ""

# Check ports
check_port 80 "nginx"
check_port 5901 "VNC"
check_port 6080 "noVNC"
check_port 9222 "Chrome CDP"
check_port 10080 "openvscode"
check_port 39377 "cmux-worker"

echo ""

# Check Chrome CDP specifically
echo "Chrome CDP Version:"
CHROME_CDP=$(curl -s http://localhost:9222/json/version 2>/dev/null || echo "")
if [ -n "$CHROME_CDP" ]; then
    echo "$CHROME_CDP" | jq -r '.Browser // "Unknown"'
else
    echo -e "${RED}[FAIL]${NC} Chrome CDP not responding"
    FAILED=1
fi

echo ""

# Check Docker specifically
echo "Docker Version:"
DOCKER_VER=$(docker --version 2>/dev/null || echo "")
if [ -n "$DOCKER_VER" ]; then
    echo -e "${GREEN}[OK]${NC} $DOCKER_VER"
else
    echo -e "${RED}[FAIL]${NC} Docker not responding"
    FAILED=1
fi

# -----------------------------------------------------------------------------
# Create marker file
# -----------------------------------------------------------------------------
touch /cmux_base_snapshot_valid
echo "CMUX_SNAPSHOT_VERSION=1.0" > /cmux_snapshot_info
echo "CMUX_SNAPSHOT_DATE=$(date -Iseconds)" >> /cmux_snapshot_info

echo ""
echo "=============================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}       SETUP COMPLETED SUCCESSFULLY!        ${NC}"
    echo "=============================================="
    echo ""
    echo "All services are running. You can now:"
    echo "  1. Save this VM as a snapshot"
    echo "  2. Use this snapshot as the base for cmux devbox workspaces"
    echo ""
    echo "Marker file created: /cmux_base_snapshot_valid"
else
    echo -e "${RED}       SETUP COMPLETED WITH ERRORS          ${NC}"
    echo "=============================================="
    echo ""
    echo "Some services failed to start. Please check:"
    echo "  journalctl -u <service-name> -n 50"
    echo ""
    exit 1
fi

echo "Completed at: $(date)"
