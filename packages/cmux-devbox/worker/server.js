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

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 39377;
const VSCODE_PORT = Number(process.env.CMUX_VSCODE_PORT || 39378);
const VNC_PORT = Number(process.env.CMUX_VNC_PORT || 39380);
const PTY_PORT = Number(process.env.CMUX_PTY_PORT || 39379);
const AUTH_COOKIE_NAME = 'cmux_auth';
const VNC_PREFIX = '/vnc';
const CMUX_PREFIX = '/_cmux';
const OWNER_ID_FILE = '/var/run/cmux/owner-id';
const PROJECT_ID_FILE = '/var/run/cmux/stack-project-id';

// Auth configuration - loaded at startup
let ownerId = null;
let projectId = null;
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Load auth configuration from files
 */
function loadAuthConfig() {
  try {
    ownerId = fs.readFileSync(OWNER_ID_FILE, 'utf8').trim();
    projectId = fs.readFileSync(PROJECT_ID_FILE, 'utf8').trim();
    console.log(`Auth config loaded: owner=${ownerId}, project=${projectId}`);
    return true;
  } catch (e) {
    console.error('Warning: Could not load auth config:', e.message);
    console.error('JWT auth will be disabled. Set up owner-id and stack-project-id files.');
    return false;
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
 * Parse cookies from request
 */
function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim();
    if (!key) return acc;
    const value = rest.join('=').trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

/**
 * Extract auth token from headers, cookies, or query params
 */
function getAuthToken(req, url) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    if (type === 'Bearer' && token) {
      return { token, source: 'header' };
    }
  }

  const cookies = parseCookies(req.headers['cookie']);
  if (cookies[AUTH_COOKIE_NAME]) {
    return { token: cookies[AUTH_COOKIE_NAME], source: 'cookie' };
  }

  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return { token: queryToken, source: 'query' };
  }

  return null;
}

/**
 * Verify authentication - checks JWT and owner ID
 */
async function verifyAuth(req, url) {
  // If auth config not loaded, deny all requests
  if (!ownerId || !projectId) {
    return { valid: false, error: 'Auth not configured' };
  }

  const tokenInfo = getAuthToken(req, url);
  if (!tokenInfo) {
    return { valid: false, error: 'No authorization token' };
  }

  try {
    const payload = await verifyJWT(tokenInfo.token);

    // Check if user ID matches owner
    const userId = payload.sub;
    if (userId !== ownerId) {
      return { valid: false, error: 'User is not the instance owner' };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp ? Math.max(0, payload.exp - now) : null;

    return { valid: true, userId, token: tokenInfo.token, source: tokenInfo.source, expiresIn };
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

function setAuthCookie(res, token, expiresIn) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
  ];
  if (expiresIn !== null) {
    parts.push(`Max-Age=${expiresIn}`);
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function stripTokenParam(url) {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete('token');
  return cleaned;
}

function isApiPath(pathname) {
  return [
    '/snapshot',
    '/open',
    '/click',
    '/dblclick',
    '/type',
    '/fill',
    '/press',
    '/hover',
    '/scroll',
    '/screenshot',
    '/back',
    '/forward',
    '/reload',
    '/url',
    '/title',
    '/wait',
    '/eval',
  ].includes(pathname);
}

function isCmuxPath(pathname) {
  return pathname.startsWith('/_cmux/');
}

function isVncPath(pathname) {
  return pathname === VNC_PREFIX || pathname.startsWith(`${VNC_PREFIX}/`) || pathname === '/websockify';
}

function buildUpstreamPath(url, prefix) {
  const cleaned = stripTokenParam(url);
  let path = cleaned.pathname + cleaned.search;
  if (prefix && path.startsWith(prefix)) {
    path = path.slice(prefix.length);
    if (path === '') {
      path = '/';
    }
  }
  return path;
}

function proxyHttp(req, res, targetHost, targetPort, upstreamPath) {
  const headers = { ...req.headers };
  headers.host = `${targetHost}:${targetPort}`;
  delete headers.authorization;
  delete headers.cookie;

  const proxyReq = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

function proxyWebsocket(req, socket, head, targetHost, targetPort, upstreamPath) {
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = { ...req.headers };
    headers.host = `${targetHost}:${targetPort}`;
    delete headers.authorization;
    delete headers.cookie;

    let requestLines = `${req.method} ${upstreamPath} HTTP/${req.httpVersion}\r\n`;
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          requestLines += `${name}: ${v}\r\n`;
        }
      } else if (value !== undefined) {
        requestLines += `${name}: ${value}\r\n`;
      }
    }
    requestLines += '\r\n';
    upstream.write(requestLines);
    if (head && head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', (err) => {
    console.error('Websocket proxy error:', err.message);
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.error('Websocket client error:', err.message);
    upstream.destroy();
  });
}

/**
 * Handle requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  // Health check doesn't require auth
  if (reqPath === '/health') {
    sendJson(res, { status: 'ok' });
    return;
  }

  const apiPath = isApiPath(reqPath);
  if (apiPath) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // All other endpoints require authentication
  const authResult = await verifyAuth(req, url);
  if (!authResult.valid) {
    sendJson(res, { error: 'Unauthorized', message: authResult.error || 'Authentication required' }, 401);
    return;
  }

  if (authResult.source === 'query' && req.method === 'GET' && !apiPath) {
    setAuthCookie(res, authResult.token, authResult.expiresIn);
    const redirectUrl = stripTokenParam(url);
    res.writeHead(302, { Location: redirectUrl.pathname + redirectUrl.search });
    res.end();
    return;
  }

  try {
    let result;
    let body = {};

    if (apiPath) {
      if (req.method === 'POST') {
        body = await parseBody(req);
      }

      switch (reqPath) {

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
            try {
              fs.unlinkSync(ssResult.data.path);
            } catch (e) {
              console.error('Failed to clean up screenshot:', e.message);
            }
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

        default:
          sendJson(res, { error: 'Not found' }, 404);
          return;
      }

      sendJson(res, result);
      return;
    }

    // Handle /_cmux/* endpoints
    if (isCmuxPath(reqPath)) {
      // /_cmux/generate-token - Generate a one-time auth token for browser auth
      if (reqPath === '/_cmux/generate-token' && req.method === 'POST') {
        // The user is already authenticated via JWT, return the token for cookie auth
        sendJson(res, { token: authResult.token });
        return;
      }

      // /_cmux/auth - Set auth cookie and redirect
      if (reqPath === '/_cmux/auth' && req.method === 'GET') {
        const returnPath = url.searchParams.get('return') || '/';
        setAuthCookie(res, authResult.token, authResult.expiresIn);
        res.writeHead(302, { Location: returnPath });
        res.end();
        return;
      }

      // /_cmux/pty/* - Proxy to PTY service
      if (reqPath.startsWith('/_cmux/pty/')) {
        const ptyPath = reqPath.slice('/_cmux/pty'.length);
        proxyHttp(req, res, '127.0.0.1', PTY_PORT, ptyPath);
        return;
      }

      sendJson(res, { error: 'Not found' }, 404);
      return;
    }

    const targetHost = '127.0.0.1';
    const isVnc = isVncPath(reqPath);
    const targetPort = isVnc ? VNC_PORT : VSCODE_PORT;
    const upstreamPath = buildUpstreamPath(url, isVnc ? VNC_PREFIX : '');
    proxyHttp(req, res, targetHost, targetPort, upstreamPath);
  } catch (err) {
    console.error('Error:', err.message);
    sendJson(res, { success: false, error: err.message }, 500);
  }
}

const server = http.createServer(handleRequest);

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const authResult = await verifyAuth(req, url);
  if (!authResult.valid) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const reqPath = url.pathname;
  const targetHost = '127.0.0.1';

  // Handle /_cmux/pty/ws/* WebSocket connections
  if (reqPath.startsWith('/_cmux/pty/')) {
    const ptyPath = reqPath.slice('/_cmux/pty'.length);
    proxyWebsocket(req, socket, head, targetHost, PTY_PORT, ptyPath);
    return;
  }

  const isVnc = isVncPath(reqPath);
  const targetPort = isVnc ? VNC_PORT : VSCODE_PORT;
  const upstreamPath = buildUpstreamPath(url, isVnc ? VNC_PREFIX : '');

  proxyWebsocket(req, socket, head, targetHost, targetPort, upstreamPath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`cmux devbox Worker daemon listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
