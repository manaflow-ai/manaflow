#!/usr/bin/env node
/**
 * VNC Auth Proxy - Token-based authentication for noVNC
 *
 * Architecture (matches Morph Go proxy):
 * 1. Serves noVNC static files directly from /opt/noVNC
 * 2. Proxies WebSocket on /websockify directly to VNC server (5901)
 * 3. Validates ?tkn= parameter and uses session cookies
 *
 * Flow:
 * 1. User visits https://...:39380/vnc.html?tkn=<full_token>
 * 2. Proxy validates token against /home/user/.worker-auth-token
 * 3. If valid, sets a session cookie and serves noVNC files
 * 4. WebSocket connections on /websockify validate via session cookie and proxy to VNC
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const net = require('net');

const AUTH_TOKEN_FILE = '/home/user/.worker-auth-token';
const VNC_PORT = 5901;  // Direct VNC server port
const PROXY_PORT = 39380;  // External port (token-validated)
const NOVNC_DIR = '/opt/noVNC';  // noVNC static files
const SESSION_COOKIE_NAME = 'vnc_session';

// Simple in-memory session store (sessions expire after 24 hours)
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(token) {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    token,
    createdAt: Date.now(),
  });
  return sessionId;
}

function validateSession(sessionId) {
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Check if session expired
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(sessionId);
    return false;
  }

  // Validate the token is still valid
  const currentToken = getAuthToken();
  return session.token === currentToken;
}

function getAuthToken() {
  try {
    return fs.readFileSync(AUTH_TOKEN_FILE, 'utf8').trim();
  } catch (err) {
    console.error('[vnc-auth] Failed to read auth token:', err.message);
    return null;
  }
}

function validateToken(providedToken) {
  const authToken = getAuthToken();
  if (!authToken) return false;
  return providedToken === authToken;
}

function extractToken(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.searchParams.get('tkn') || url.searchParams.get('token');
  } catch {
    return null;
  }
}

function extractSessionFromCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) acc[key] = value;
    return acc;
  }, {});
  return cookies[SESSION_COOKIE_NAME];
}

function getSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=None; Secure`;
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000); // Clean up every hour

// Serve static file from noVNC directory
function serveStaticFile(req, res, filePath, sessionId) {
  const fullPath = path.join(NOVNC_DIR, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(NOVNC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try index.html for directory requests
      if (!err && stats.isDirectory()) {
        serveStaticFile(req, res, path.join(filePath, 'index.html'), sessionId);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };

    // Set session cookie if we have a new session
    if (sessionId) {
      headers['Set-Cookie'] = getSessionCookie(sessionId);
    }

    res.writeHead(200, headers);
    fs.createReadStream(fullPath).pipe(res);
  });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Allow health check without auth
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Check for token in URL first
  const token = extractToken(req);
  const existingSession = extractSessionFromCookie(req);

  let isAuthorized = false;
  let newSessionId = null;

  if (token && validateToken(token)) {
    // Valid token - create new session
    newSessionId = createSession(token);
    isAuthorized = true;
    console.log('[vnc-auth] Token validated, session created');
  } else if (existingSession && validateSession(existingSession)) {
    // Valid existing session
    isAuthorized = true;
    console.log('[vnc-auth] Session validated');
  }

  if (!isAuthorized) {
    console.log('[vnc-auth] Unauthorized request - invalid token and no valid session');
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden', message: 'Invalid or missing token' }));
    return;
  }

  // If we just validated a token, redirect to strip it from URL (like VSCode does)
  if (newSessionId && token) {
    // Build redirect URL without the token
    const redirectUrl = new URL(req.url, `http://${req.headers.host}`);
    redirectUrl.searchParams.delete('tkn');
    redirectUrl.searchParams.delete('token');

    console.log(`[vnc-auth] Redirecting to strip token from URL`);
    res.writeHead(302, {
      'Location': redirectUrl.pathname + redirectUrl.search,
      'Set-Cookie': getSessionCookie(newSessionId),
    });
    res.end();
    return;
  }

  // Handle static files
  let filePath = pathname === '/' ? '/vnc.html' : pathname;

  // Remove query string from path
  filePath = filePath.split('?')[0];

  console.log(`[vnc-auth] Serving: ${filePath}`);
  serveStaticFile(req, res, filePath, newSessionId);
});

// Handle WebSocket upgrades for /websockify
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Only handle /websockify
  if (pathname !== '/websockify' && pathname !== '/websockify/') {
    console.log(`[vnc-auth] WebSocket upgrade rejected - wrong path: ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // Check token in URL first, then session cookie
  const token = extractToken(req);
  const sessionId = extractSessionFromCookie(req);

  let isAuthorized = false;

  if (token && validateToken(token)) {
    isAuthorized = true;
    console.log('[vnc-auth] WebSocket authorized via token');
  } else if (sessionId && validateSession(sessionId)) {
    isAuthorized = true;
    console.log('[vnc-auth] WebSocket authorized via session cookie');
  }

  if (!isAuthorized) {
    console.log('[vnc-auth] WebSocket unauthorized - no valid token or session');
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Connect directly to VNC server (like Morph Go proxy)
  const vncSocket = net.connect(VNC_PORT, '127.0.0.1', () => {
    console.log('[vnc-auth] Connected to VNC server');

    // Disable Nagle's algorithm for low-latency VNC
    vncSocket.setNoDelay(true);
    socket.setNoDelay(true);

    // Perform WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    const protocol = req.headers['sec-websocket-protocol'];

    if (!key) {
      console.log('[vnc-auth] Missing Sec-WebSocket-Key');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      vncSocket.destroy();
      return;
    }

    // Calculate accept key
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    // Send WebSocket handshake response
    let response = 'HTTP/1.1 101 Switching Protocols\r\n';
    response += 'Upgrade: websocket\r\n';
    response += 'Connection: Upgrade\r\n';
    response += `Sec-WebSocket-Accept: ${acceptKey}\r\n`;
    if (protocol) {
      // noVNC uses 'binary' subprotocol
      const protocols = protocol.split(',').map(p => p.trim());
      if (protocols.includes('binary')) {
        response += 'Sec-WebSocket-Protocol: binary\r\n';
      }
    }
    response += '\r\n';

    socket.write(response);

    // Now bridge WebSocket frames to raw TCP
    // We need to decode WebSocket frames and send raw data to VNC
    // And encode VNC responses as WebSocket frames

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const secondByte = buffer[1];
        const masked = (secondByte & 0x80) !== 0;
        let payloadLength = secondByte & 0x7f;
        let offset = 2;

        if (payloadLength === 126) {
          if (buffer.length < 4) break;
          payloadLength = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLength === 127) {
          if (buffer.length < 10) break;
          // For simplicity, assume payload < 4GB
          payloadLength = buffer.readUInt32BE(6);
          offset = 10;
        }

        const maskOffset = offset;
        if (masked) {
          offset += 4;
        }

        if (buffer.length < offset + payloadLength) break;

        let payload = buffer.slice(offset, offset + payloadLength);

        if (masked) {
          const mask = buffer.slice(maskOffset, maskOffset + 4);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
          }
        }

        // Check for close frame
        const opcode = firstByte & 0x0f;
        if (opcode === 0x08) {
          // Close frame
          socket.end();
          vncSocket.end();
          return;
        }

        // Send decoded data to VNC server
        vncSocket.write(payload);

        buffer = buffer.slice(offset + payloadLength);
      }
    });

    vncSocket.on('data', (data) => {
      // Encode as WebSocket binary frame
      const frames = [];
      let remaining = data;

      while (remaining.length > 0) {
        const chunkSize = Math.min(remaining.length, 65535);
        const chunk = remaining.slice(0, chunkSize);
        remaining = remaining.slice(chunkSize);

        let header;
        if (chunk.length < 126) {
          header = Buffer.alloc(2);
          header[0] = 0x82; // FIN + binary opcode
          header[1] = chunk.length;
        } else {
          header = Buffer.alloc(4);
          header[0] = 0x82; // FIN + binary opcode
          header[1] = 126;
          header.writeUInt16BE(chunk.length, 2);
        }

        frames.push(header, chunk);
      }

      if (frames.length > 0) {
        socket.write(Buffer.concat(frames));
      }
    });

    socket.on('close', () => {
      console.log('[vnc-auth] Client WebSocket closed');
      vncSocket.destroy();
    });

    socket.on('error', (err) => {
      console.error('[vnc-auth] Client socket error:', err.message);
      vncSocket.destroy();
    });

    vncSocket.on('close', () => {
      console.log('[vnc-auth] VNC connection closed');
      socket.destroy();
    });

    vncSocket.on('error', (err) => {
      console.error('[vnc-auth] VNC socket error:', err.message);
      socket.destroy();
    });
  });

  vncSocket.on('error', (err) => {
    console.error('[vnc-auth] Failed to connect to VNC server:', err.message);
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[vnc-auth] VNC proxy listening on port ${PROXY_PORT}`);
  console.log(`[vnc-auth] Serving noVNC from ${NOVNC_DIR}`);
  console.log(`[vnc-auth] WebSocket /websockify -> VNC server on port ${VNC_PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[vnc-auth] Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[vnc-auth] Shutting down...');
  server.close(() => process.exit(0));
});
