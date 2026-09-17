'use strict';
const http = require('http');
const crypto = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { nextAfter, REPEATS } = require('../scheduler');

/**
 * Exposes the memory to any MCP client, over HTTP on loopback.
 *
 * Three things keep a local server like this from being a hole in the machine:
 *
 *   - it binds to 127.0.0.1 only, so nothing off-box can reach it at all;
 *   - every request needs a bearer token generated on first run, because any
 *     web page you visit can also POST to localhost;
 *   - the Origin header is checked, because a browser will happily send one
 *     from a site you did not expect (DNS rebinding), and the MCP spec calls
 *     this out specifically.
 *
 * Runs stateless: a fresh server and transport per request. There is no
 * long-lived session to leak, and a client that dies mid-call leaves nothing.
 */

const DEFAULT_PORT = 8787;

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Constant-time compare so a wrong token cannot be guessed by timing. */
function tokenMatches(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function excerpt(text, limit = 600) {
  const t = text.trim();
  return t.length <= limit ? t : t.slice(0, limit) + '…';
}

class McpBridge {
  /**
   * @param {object} deps
   * @param {import('../memory').Memory} deps.memory
   * @param {object} deps.reminders  { list, add }
   * @param {() => object} deps.settings
   */
  constructor({ memory, reminders, settings }) {
    this.memory = memory;
    this.reminders = reminders;
    this.settings = settings;
    this.server = null;
    this.port = null;
    this.token = null;
    this.lastError = null;
    this.calls = [];
  }

  /* ---------------- tools ---------------- */

  _build() {
    const mcp = new McpServer(
      { name: 'nibble-memory', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const note = (name, args) => {
      this.calls.unshift({ ts: Date.now(), name, args });
      this.calls.length = Math.min(this.calls.length, 50);
    };

    const text = (s) => ({ content: [{ type: 'text', text: s }] });

    mcp.registerTool(
      'search_memory',
      {
        title: 'Search memory',
        description:
          'Search the user\'s captured memory: things they copied, notes they keep, files they wrote. ' +
          'Combines keyword and semantic matching, so paraphrasing the question works. ' +
          'Use this before asking the user to re-explain context they may have already recorded.',
        inputSchema: {
          query: z.string().describe('What to look for, in natural language'),
          limit: z.number().int().min(1).max(25).optional().describe('How many results (default 8)'),
          source: z.string().optional().describe('Restrict to one capture source, e.g. clipboard or files'),
          since_days: z.number().int().min(1).optional().describe('Only consider the last N days'),
        },
      },
      async ({ query, limit, source, since_days }) => {
        note('search_memory', { query, limit, source, since_days });
        const hits = await this.memory.search(query, {
          k: limit || 8,
          source: source || null,
          since: since_days ? Date.now() - since_days * 86400000 : null,
        });
        if (!hits.length) return text(`No memory matches "${query}".`);

        return text(
          hits
            .map((h, i) => {
              const when = new Date(h.ts).toISOString().slice(0, 16).replace('T', ' ');
              const head = h.title ? `${h.title} — ` : '';
              return `[${i + 1}] ${head}${h.source}, ${when} (matched on ${h.matched})\n${excerpt(h.text)}`;
            })
            .join('\n\n')
        );
      }
    );

    mcp.registerTool(
      'recent_memory',
      {
        title: 'Recent memory',
        description: 'The most recently captured items, newest first. Use for "what was I just doing" questions.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
          source: z.string().optional(),
        },
      },
      async ({ limit, source }) => {
        note('recent_memory', { limit, source });
        const items = this.memory.recent(limit || 15, source || null);
        if (!items.length) return text('Nothing captured yet.');
        return text(
          items
            .map((r) => {
              const when = new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ');
              return `${when} · ${r.source}${r.title ? ' · ' + r.title : ''}\n${excerpt(r.text, 300)}`;
            })
            .join('\n\n')
        );
      }
    );

    mcp.registerTool(
      'remember',
      {
        title: 'Remember this',
        description:
          'Save something to the user\'s memory so it can be recalled in a later conversation. ' +
          'Use when the user says to remember something, or states a durable fact about themselves.',
        inputSchema: {
          text: z.string().describe('The content to store'),
          title: z.string().optional().describe('A short label'),
        },
      },
      async ({ text: body, title }) => {
        note('remember', { title });
        const res = this.memory.capture({ source: 'assistant', kind: 'note', text: body, title: title || '' });
        if (!res.added) return text(`Not stored (${res.skipped}).`);
        return text(`Stored ${res.added} chunk${res.added === 1 ? '' : 's'}.`);
      }
    );

    mcp.registerTool(
      'memory_stats',
      {
        title: 'Memory stats',
        description: 'How much is stored, how much is indexed, and which embedding model is in use.',
        inputSchema: {},
      },
      async () => {
        note('memory_stats', {});
        const s = this.memory.stats();
        return text(
          `${s.chunks} chunks stored, ${s.embedded} embedded, ${s.pending} waiting.\n` +
            `Model: ${s.embedder.model} (${s.embedder.backend}, ${s.dim} dims, ${s.embedder.status}).\n` +
            `About ${Math.round(s.textBytes / 1024)} KB of text.`
        );
      }
    );

    mcp.registerTool(
      'list_reminders',
      {
        title: 'List reminders',
        description: 'The user\'s scheduled reminders, soonest first.',
        inputSchema: {},
      },
      async () => {
        note('list_reminders', {});
        const list = this.reminders.list();
        if (!list.length) return text('No reminders scheduled.');
        return text(
          list
            .map((r) => {
              const when = new Date(r.snoozedUntil || r.at).toLocaleString();
              const rep = r.repeat === 'none' ? 'once' : r.repeat;
              return `${r.enabled ? '•' : '◦'} ${r.title} — ${when} (${rep})${r.body ? '\n   ' + r.body : ''}`;
            })
            .join('\n')
        );
      }
    );

    mcp.registerTool(
      'add_reminder',
      {
        title: 'Add a reminder',
        description:
          'Schedule a notification. Give an absolute ISO 8601 time; resolve relative phrases like ' +
          '"tomorrow at 9" yourself before calling, using the user\'s local timezone.',
        inputSchema: {
          title: z.string().describe('What the notification should say'),
          at: z.string().describe('ISO 8601 datetime, e.g. 2026-09-18T09:00:00'),
          body: z.string().optional().describe('Second line of the notification'),
          repeat: z
            .enum(['none', 'hourly', 'daily', 'weekdays', 'weekly', 'custom'])
            .optional()
            .describe('Defaults to none'),
          interval_minutes: z.number().int().min(1).optional().describe('Only for repeat=custom'),
        },
      },
      async ({ title, at, body, repeat, interval_minutes }) => {
        note('add_reminder', { title, at, repeat });
        const ts = Date.parse(at);
        if (Number.isNaN(ts)) return text(`Could not read "${at}" as a date. Use ISO 8601.`);

        const rep = REPEATS.has(repeat) ? repeat : 'none';
        let when = ts;
        if (when <= Date.now()) {
          const next = nextAfter(when, Date.now(), rep, interval_minutes);
          if (next === null) return text(`${at} is in the past and this reminder does not repeat.`);
          when = next;
        }
        const r = this.reminders.add({
          title,
          body: body || '',
          at: when,
          repeat: rep,
          intervalMinutes: interval_minutes || 60,
        });
        return text(`Reminder "${r.title}" set for ${new Date(r.at).toLocaleString()}.`);
      }
    );

    return mcp;
  }

  /* ---------------- http ---------------- */

  _authorized(req) {
    // Loopback only is enforced at bind time; this guards against local
    // processes and browser pages that can also reach 127.0.0.1.
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const header = req.headers['x-api-key'] || '';
    return tokenMatches(bearer || header, this.token);
  }

  _originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // a non-browser client sends none
    try {
      const u = new URL(origin);
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    } catch {
      return false;
    }
  }

  async _handle(req, res) {
    if (!this._originOk(req)) {
      res.writeHead(403).end('forbidden origin');
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'nibble-memory' }));
      return;
    }
    if (!this._authorized(req)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('unauthorized');
      return;
    }
    if (!req.url.startsWith('/mcp')) {
      res.writeHead(404).end('not found');
      return;
    }

    let body;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
    }

    // Stateless: a server and transport per request, torn down with it.
    const mcp = this._build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      mcp.close().catch(() => {});
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      this.lastError = err.message;
      if (!res.headersSent) res.writeHead(500).end('mcp error');
    }
  }

  start({ port } = {}) {
    if (this.server) return this.info();

    const settings = this.settings();
    this.token = settings.mcpToken || newToken();
    const wanted = port || settings.mcpPort || DEFAULT_PORT;

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this._handle(req, res).catch((err) => {
          this.lastError = err.message;
          if (!res.headersSent) res.writeHead(500).end('error');
        });
      });

      server.on('error', (err) => {
        // A busy port is the common case; fall back to an ephemeral one
        // rather than leaving the connector dead.
        if (err.code === 'EADDRINUSE' && this.port === null) {
          server.listen(0, '127.0.0.1');
          return;
        }
        this.lastError = err.message;
        this.server = null;
        resolve(this.info());
      });

      server.listen(wanted, '127.0.0.1', () => {
        this.server = server;
        this.port = server.address().port;
        this.lastError = null;
        resolve(this.info());
      });
    });
  }

  stop() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
    this.port = null;
  }

  regenerateToken() {
    this.token = newToken();
    return this.info();
  }

  info() {
    const url = this.port ? `http://127.0.0.1:${this.port}/mcp` : null;
    return {
      running: Boolean(this.server),
      port: this.port,
      token: this.token,
      url,
      error: this.lastError,
      calls: this.calls.slice(0, 10),
    };
  }
}

module.exports = { McpBridge, DEFAULT_PORT };
