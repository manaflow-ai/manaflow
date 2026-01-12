#!/usr/bin/env node
// E2E test for ACP WebSocket connection to cmux-acp-server

import WebSocket from 'ws';

const JWT = process.argv[2] || process.env.TEST_CONVERSATION_JWT;
if (!JWT) {
  console.error('Usage: node acp-e2e-test.mjs <jwt>');
  process.exit(1);
}

const WS_URL = 'ws://localhost:39384/api/acp';

console.log('Connecting to:', WS_URL);

const ws = new WebSocket(WS_URL, {
  headers: {
    'Authorization': `Bearer ${JWT}`,
    'x-acp-params': 'provider=claude',
    'x-acp-cwd': '/tmp'
  }
});

let messageId = 1;
let sessionId = null;

function send(method, params, id = messageId++) {
  const msg = { jsonrpc: '2.0', id, method, params };
  console.log('\n→ SEND:', JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));
  return id;
}

function sendNotification(method, params) {
  const msg = { jsonrpc: '2.0', method, params };
  console.log('\n→ NOTIFY:', JSON.stringify(msg, null, 2));
  ws.send(JSON.stringify(msg));
}

ws.on('open', () => {
  console.log('✓ WebSocket connected\n');

  // Step 1: Send initialize request
  send('initialize', {
    protocolVersion: 1,
    capabilities: {},
    clientInfo: { name: 'acp-e2e-test', version: '1.0.0' }
  });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('\n← RECV:', JSON.stringify(msg, null, 2));

  // Handle initialize response
  if (msg.id === 1 && msg.result) {
    console.log('\n✓ Initialize succeeded');
    console.log('  Agent:', msg.result.agentInfo?.name, msg.result.agentInfo?.version);

    // Step 2: Create session
    send('session/new', {
      sessionId: 'test-session-' + Date.now(),
      cwd: '/tmp',
      mcpServers: []
    });
  }

  // Handle session/new response
  if (msg.id === 2 && msg.result) {
    sessionId = msg.result.sessionId;
    console.log('\n✓ Session created:', sessionId);

    // Step 3: Send prompt "What is 2+3?"
    send('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'What is 2+3? Reply with just the number.' }]
    });
  }

  // Handle streaming updates
  if (msg.method === 'session/update') {
    const update = msg.params?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') {
      process.stdout.write(update.content?.text || '');
    }
  }

  // Handle prompt response (final)
  if (msg.id === 3 && msg.result) {
    console.log('\n\n✓ Prompt completed');
    console.log('  Stop reason:', msg.result.stopReason);

    // Done - close connection
    setTimeout(() => {
      console.log('\n✓ Test complete!');
      ws.close();
      process.exit(0);
    }, 1000);
  }

  // Handle errors
  if (msg.error) {
    console.error('\n✗ Error:', msg.error);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  console.log('\nWebSocket closed:', code, reason.toString());
});

// Timeout after 60 seconds
setTimeout(() => {
  console.error('\n✗ Test timed out');
  ws.close();
  process.exit(1);
}, 60000);
