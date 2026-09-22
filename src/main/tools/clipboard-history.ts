import fs from 'fs';
import path from 'path';
import { clipboard } from 'electron';
import { isSecret } from '../capture/clipboard';
import type { ClipboardEntry } from '../../types';

/**
 * A searchable clipboard history, independent of the memory system's own
 * Clipboard capture source. That one writes into the searchable, MCP-exposed
 * memory and can be switched off; this one is a plain "what did I just copy"
 * ring buffer, kept only for quick recall in the notch and never indexed or
 * exposed to a model.
 *
 * It reuses the memory source's credential filter, because a text a person
 * would not want captured into long-term memory is not one they would want
 * sitting in a clipboard history either.
 */

const POLL_MS = 700;
const MAX_ENTRIES = 300;
const MIN_LEN = 1;
const MAX_LEN = 20_000;

export class ClipboardHistory {
  private readonly file: string;
  private entries: ClipboardEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private last = '';

  constructor(dir: string) {
    this.file = path.join(dir, 'tools-clipboard.json');
    this.entries = this.read();
    try {
      this.last = clipboard.readText() || '';
    } catch {
      this.last = '';
    }
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  private read(): ClipboardEntry[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {
      /* history is a convenience, not a record worth failing over */
    }
  }

  private poll(): void {
    let text: string;
    try {
      text = clipboard.readText();
    } catch {
      return; // another app is holding the pasteboard
    }
    if (!text || text === this.last) return;
    this.last = text;
    if (text.length < MIN_LEN || text.length > MAX_LEN) return;
    if (isSecret(text)) return;

    // A re-copy of something already at the top of the list moves it up
    // rather than duplicating it.
    this.entries = this.entries.filter((e) => e.text !== text);
    this.entries.unshift({
      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      ts: Date.now(),
      pinned: false,
    });

    // Pinned entries never age out; only the unpinned tail is trimmed.
    const pinned = this.entries.filter((e) => e.pinned);
    const rest = this.entries.filter((e) => !e.pinned).slice(0, MAX_ENTRIES);
    this.entries = [...pinned, ...rest].sort((a, b) => b.ts - a.ts);
    this.write();
  }

  list(query?: string): ClipboardEntry[] {
    const q = (query ?? '').trim().toLowerCase();
    const rows = q ? this.entries.filter((e) => e.text.toLowerCase().includes(q)) : this.entries;
    // Pinned first, then most recent.
    return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts);
  }

  copy(id: string): boolean {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return false;
    clipboard.writeText(e.text);
    this.last = e.text; // don't re-add it as a "new" copy on the next poll
    return true;
  }

  pin(id: string, pinned: boolean): ClipboardEntry[] {
    const e = this.entries.find((x) => x.id === id);
    if (e) e.pinned = pinned;
    this.write();
    return this.list();
  }

  remove(id: string): ClipboardEntry[] {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.write();
    return this.list();
  }

  clear(): ClipboardEntry[] {
    this.entries = this.entries.filter((e) => e.pinned);
    this.write();
    return this.list();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
