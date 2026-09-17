import fs from 'fs';
import path from 'path';
import type { CaptureContext, CaptureSource, SourceDeps, SourceInstance } from '../../types';

/**
 * Watches folders you nominate and remembers the text files in them.
 *
 * Intended for a notes directory, a journal, a meeting-minutes folder -- the
 * places where things you would later want to ask about already accumulate.
 * Only text-ish files are read, and only up to a size ceiling, so pointing it
 * at a source tree or a Downloads folder cannot wedge the app.
 */

const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.rst',
  '.org',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.log',
]);

const MAX_BYTES = 2 * 1024 * 1024;
const SCAN_MS = 60_000;
const SETTLE_MS = 1500; // editors write in bursts; wait for the dust to settle

/** A binary file given a text extension decodes to NUL bytes. */
const NUL = String.fromCharCode(0);

function listTextFiles(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > 4 || out.length > 5000) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) listTextFiles(full, depth + 1, out);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

const source: CaptureSource = {
  id: 'files',
  label: 'Folders',
  description:
    'Reads text and Markdown files from folders you choose, and notices when they change.',
  platforms: ['darwin', 'win32', 'linux'],
  permission: null,
  implemented: true,

  available() {
    return { ok: true };
  },

  create({ settings }: SourceDeps): SourceInstance {
    let watchers: fs.FSWatcher[] = [];
    let scanTimer: NodeJS.Timeout | null = null;
    let pending = new Map<string, NodeJS.Timeout>();
    const seen = new Map<string, number>();
    let captured = 0;
    let context: CaptureContext | null = null;

    function ingest(file: string): void {
      if (!context) return;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        return;
      }
      if (stat.size > MAX_BYTES) return;
      if (seen.get(file) === stat.mtimeMs) return;
      seen.set(file, stat.mtimeMs);

      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return;
      }
      if (text.includes(NUL)) return;

      const res = context.capture({
        source: 'files',
        kind: 'file',
        text,
        title: path.basename(file),
        ts: stat.mtimeMs,
        meta: { path: file },
      });
      if (res.added) captured++;
    }

    function scheduleIngest(file: string): void {
      const existing = pending.get(file);
      if (existing) clearTimeout(existing);
      pending.set(
        file,
        setTimeout(() => {
          pending.delete(file);
          ingest(file);
        }, SETTLE_MS)
      );
    }

    function scan(): void {
      for (const root of settings().memoryFolders ?? []) {
        for (const file of listTextFiles(root)) ingest(file);
      }
    }

    function rewatch(): void {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      watchers = [];

      for (const root of settings().memoryFolders ?? []) {
        try {
          const w = fs.watch(root, { recursive: true }, (_event, name) => {
            if (!name) return;
            const file = path.join(root, name.toString());
            if (!TEXT_EXT.has(path.extname(file).toLowerCase())) return;
            scheduleIngest(file);
          });
          watchers.push(w);
        } catch {
          // Recursive watch is unsupported on some Linux setups; the periodic
          // scan is the fallback and catches everything anyway.
        }
      }
    }

    return {
      start(ctx) {
        context = ctx;
        rewatch();
        scan();
        scanTimer = setInterval(scan, SCAN_MS);
      },

      stop() {
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = null;
        for (const t of pending.values()) clearTimeout(t);
        pending = new Map();
        for (const w of watchers) {
          try {
            w.close();
          } catch {
            /* already closed */
          }
        }
        watchers = [];
      },

      /** Called when the folder list changes in settings. */
      refresh() {
        rewatch();
        scan();
      },

      state() {
        return {
          running: scanTimer !== null,
          captured,
          folders: (settings().memoryFolders ?? []).length,
        };
      },
    };
  },
};

export default source;
