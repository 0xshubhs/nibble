#!/usr/bin/env node
'use strict';

/**
 * A stdio MCP server that relays to the running app.
 *
 * Claude Desktop and Claude Code speak MCP over stdio to a process they spawn;
 * the memory itself lives in the app, which already serves MCP over loopback
 * HTTP. This is the part in between.
 *
 * Deliberately zero-dependency. It has to run as a bare file under whatever
 * node the client happens to spawn -- including when it has been unpacked
 * beside a packaged app, where `require` cannot reach the app's node_modules.
 * Everything here is stdlib plus the built-in fetch.
 *
 * Relaying rather than reading the store directly is also deliberate: the app
 * owns the files and is appending to them, and it already has the embedding
 * model loaded, so a query here costs no second copy of the model.
 *
 * Config, in order of preference:
 *   NIBBLE_MCP_URL + NIBBLE_MCP_TOKEN
 *   the app's store.json in the usual per-user location
 *
 * Register it with:
 *   claude mcp add nibble -- node /path/to/src/mcp/stdio.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR_NAME = 'Nibble';

/* ---------------- config ---------------- */

function defaultStorePath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR_NAME, 'store.json');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, APP_DIR_NAME, 'store.json');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, APP_DIR_NAME, 'store.json');
}

/**
 * Re-read on every call rather than caching: the app may not have been running
 * when this process started, and the token can be regenerated from the UI.
 */
function readConfig() {
  if (process.env.NIBBLE_MCP_URL && process.env.NIBBLE_MCP_TOKEN) {
    return { url: process.env.NIBBLE_MCP_URL, token: process.env.NIBBLE_MCP_TOKEN };
  }
  const file = process.env.NIBBLE_STORE || defaultStorePath();
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8')).settings || {};
  } catch {
    throw new Error(
      `Could not read ${file}. Open ${APP_DIR_NAME} once and turn the connector on, ` +
        'or set NIBBLE_MCP_URL and NIBBLE_MCP_TOKEN.'
    );
  }
  if (!settings.mcpToken) {
    throw new Error(`${APP_DIR_NAME} has no connector token yet. Open it and turn the connector on.`);
  }
  return {
    url: `http://127.0.0.1:${settings.mcpPort || 8787}/mcp`,
    token: settings.mcpToken,
  };
}

/* ---------------- transport ---------------- */

const OUT = process.stdout;

/** One JSON object per line -- the framing the stdio transport specifies. */
function write(msg) {
  OUT.write(JSON.stringify(msg) + '\n');
}

function fail(id, code, message) {
  if (id === undefined || id === null) return; // notifications get no reply
  write({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * The HTTP side may answer as plain JSON or as a one-shot SSE stream,
 * depending on what the server decides; handle both.
 */
function parseBody(contentType, raw) {
  if (!raw) return null;
  if ((contentType || '').includes('text/event-stream')) {
    for (const line of raw.split('\n')) {
      if (line.startsWith('data:')) return JSON.parse(line.slice(5).trim());
    }
    return null;
  }
  return JSON.parse(raw);
}

async function forward(message) {
  const { url, token } = readConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(message),
  });

  if (res.status === 401) throw new Error('Connector rejected the token. Regenerate it in the app.');
  if (res.status === 202) return null; // accepted notification
  if (!res.ok) throw new Error(`Connector returned ${res.status}`);

  return parseBody(res.headers.get('content-type'), await res.text());
}

/* ---------------- loop ---------------- */

async function handle(message) {
  const { id } = message;
  try {
    const reply = await forward(message);
    if (reply !== null && reply !== undefined) write(reply);
  } catch (err) {
    // A tool call that cannot reach the app should read as a tool failure the
    // model can recover from, not a dead connection.
    if (message.method === 'tools/call') {
      write({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `${APP_DIR_NAME} is not reachable: ${err.message}` }],
        },
      });
    } else {
      fail(id, -32603, err.message);
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, 'parse error');
      continue;
    }
    // Deliberately not awaited: requests are independent and the upstream is
    // stateless, so a slow search must not block the next call.
    handle(message);
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Fail loudly at startup if there is no way to reach the app, so the client
// shows a real reason instead of an empty tool list.
try {
  readConfig();
} catch (err) {
  process.stderr.write(`nibble mcp relay: ${err.message}\n`);
}
