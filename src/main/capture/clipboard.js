'use strict';
const { clipboard } = require('electron');

/**
 * Watches the clipboard and remembers what you copied.
 *
 * Electron has no clipboard-change event on any platform, so this polls. The
 * interval is a compromise: long enough to be invisible on a battery, short
 * enough that two quick copies in a row are both seen.
 */

const POLL_MS = 2500;
const MIN_LEN = 24;
const MAX_LEN = 200_000;

/**
 * Patterns for things a person would be upset to find in a searchable log.
 * This is a safety net, not a guarantee -- it is deliberately biased towards
 * dropping something harmless over storing a credential.
 */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,            // OpenAI-style keys
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,       // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,     // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/,                 // AWS access key ids
  /\bAIza[0-9A-Za-z_-]{35}\b/,            // Google API keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWTs
  /\b(?:\d[ -]*?){13,16}\b/,              // card-shaped digit runs
  /\b(?:pass(?:word|phrase)|secret|api[_ -]?key|token)\b\s*[:=]/i,
];

/** A long unbroken high-entropy blob is almost always a credential. */
function looksRandom(text) {
  const t = text.trim();
  if (t.length < 24 || t.length > 200 || /\s/.test(t)) return false;
  const classes =
    Number(/[a-z]/.test(t)) + Number(/[A-Z]/.test(t)) + Number(/\d/.test(t)) + Number(/[^A-Za-z0-9]/.test(t));
  if (classes < 3) return false;
  const unique = new Set(t).size;
  return unique / t.length > 0.5;
}

function isSecret(text) {
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  return looksRandom(text);
}

module.exports = {
  id: 'clipboard',
  label: 'Clipboard',
  description: 'Remembers text you copy. Skips anything that looks like a password or key.',
  platforms: ['darwin', 'win32', 'linux'],
  permission: null,
  implemented: true,

  available() {
    return { ok: true };
  },

  create() {
    let timer = null;
    let last = '';
    let captured = 0;
    let skipped = 0;

    return {
      start(ctx) {
        // Seed with whatever is already on the clipboard so starting the
        // source does not immediately hoover up unrelated old content.
        try {
          last = clipboard.readText() || '';
        } catch {
          last = '';
        }

        timer = setInterval(() => {
          let text;
          try {
            text = clipboard.readText();
          } catch {
            return; // another app holding the pasteboard; try again next tick
          }
          if (!text || text === last) return;
          last = text;

          if (text.length < MIN_LEN || text.length > MAX_LEN) {
            skipped++;
            return;
          }
          if (isSecret(text)) {
            skipped++;
            ctx.log('clipboard: skipped something that looked like a credential');
            return;
          }

          const res = ctx.capture({
            source: 'clipboard',
            kind: 'clipboard',
            text,
            title: text.split('\n')[0].slice(0, 80),
          });
          if (res.added) captured++;
        }, POLL_MS);
      },

      stop() {
        if (timer) clearInterval(timer);
        timer = null;
      },

      state() {
        return { running: timer !== null, captured, skipped };
      },
    };
  },

  // exported for the tests
  _isSecret: isSecret,
};
