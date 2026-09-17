import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

import { MemoryStore } from './store';
import { Embedder } from './embedder';
import { chunk, normalize } from './chunker';
import type {
  BackendConfig,
  CaptureItem,
  CaptureResult,
  MemoryInput,
  MemoryStatsWithEmbedder,
  SearchHit,
  SearchOptions,
  Settings,
  StatusEvent,
} from '../../types';

const BATCH = 16;
const IDLE_MS = 120;

interface MemoryEvents {
  status: [StatusEvent];
  indexed: [ReturnType<MemoryStore['stats']>];
  captured: [{ source: string; chunks: number; title: string }];
}

export interface MemoryOptions {
  dir: string;
  settings: Settings;
}

/**
 * The memory: capture goes in, search comes out.
 *
 * Capture and embedding are deliberately decoupled. Text is written to the
 * store the instant it arrives and is immediately findable by keyword; the
 * embedder fills in the vectors behind it, so a model that is still
 * downloading, or a cloud key that is missing, degrades search quality
 * instead of dropping data on the floor.
 */
export class Memory extends EventEmitter<MemoryEvents> {
  private readonly dir: string;
  private readonly settings: Settings;

  embedder: Embedder;
  store: MemoryStore;

  private draining = false;
  private stopped = false;
  private seen = new Map<string, number>();
  private wired = false;

  constructor({ dir, settings }: MemoryOptions) {
    super();
    this.dir = dir;
    this.settings = settings;

    this.embedder = new Embedder({
      cacheDir: path.join(dir, 'models'),
      backend: settings.embedBackend ?? 'local',
      provider: settings.embedProvider ?? 'gemini',
      apiKey: settings.embedApiKey ?? '',
      allowDownload: settings.allowModelDownload !== false,
    });

    this.store = new MemoryStore(path.join(dir, 'memory'), this.embedder.expectedDim()).load();
    this.embedder.on('status', (s) => this.emit('status', s));
  }

  async start(): Promise<this> {
    await this.embedder
      .start()
      .catch((e: unknown) =>
        this.emit('status', { status: 'error', error: e instanceof Error ? e.message : String(e) })
      );

    if (this.embedder.ready) {
      // A different model means the stored vectors describe a different space.
      const reset = this.store.ensureModel(this.embedder.currentModel());
      if (reset) this.emit('status', { status: 'reindexing' });
      void this.drain();
    }

    // The local backend becomes ready asynchronously, after a download.
    if (!this.wired) {
      this.wired = true;
      this.embedder.on('status', (s) => {
        if (s.status === 'ready') {
          this.store.ensureModel(this.embedder.currentModel());
          void this.drain();
        }
      });
    }
    return this;
  }

  /* ---------------- capture ---------------- */

  capture(item: CaptureItem): CaptureResult {
    const text = normalize(item.text);
    if (!text) return { added: 0, skipped: 'empty' };

    // Ambient sources re-send the same content constantly (a clipboard that
    // has not changed, a window title that repeats). Hash-dedupe within a
    // window so the store does not fill with copies.
    const hash = crypto.createHash('sha1').update(`${item.source}|${text}`).digest('hex');
    const seenAt = this.seen.get(hash);
    const now = Date.now();
    if (seenAt && now - seenAt < 6 * 3600000) return { added: 0, skipped: 'duplicate' };
    this.seen.set(hash, now);
    if (this.seen.size > 5000) {
      // Cheap bound: keep the newest half rather than tracking a real LRU.
      const entries = [...this.seen.entries()].sort((a, b) => b[1] - a[1]);
      this.seen = new Map(entries.slice(0, 2500));
    }

    const pieces = chunk(text);
    if (!pieces.length) return { added: 0, skipped: 'too-short' };

    const records: MemoryInput[] = pieces.map((p, i) => ({
      id: `${hash.slice(0, 12)}_${i}`,
      source: item.source,
      kind: item.kind ?? 'text',
      title: item.title ?? '',
      text: p.text,
      ts: item.ts ?? now,
      meta: { ...(item.meta ?? {}), offset: p.offset, part: i, parts: pieces.length },
    }));

    // An id collision means identical content from the same source; skip it.
    const fresh = records.filter((r) => !this.store.byId.has(r.id));
    if (!fresh.length) return { added: 0, skipped: 'duplicate' };

    this.store.add(fresh);
    this.emit('captured', { source: item.source, chunks: fresh.length, title: item.title ?? '' });
    void this.drain();
    return { added: fresh.length, skipped: null };
  }

  /* ---------------- embedding queue ---------------- */

  private async drain(): Promise<void> {
    if (this.draining || this.stopped || !this.embedder.ready) return;
    this.draining = true;

    try {
      for (;;) {
        if (this.stopped) break;
        const batch = this.store.pending(BATCH);
        if (!batch.length) break;

        let vectors: Float32Array[];
        try {
          vectors = await this.embedder.embed(batch.map((r) => r.text));
        } catch (err) {
          this.emit('status', {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          break; // retried on the next capture or restart
        }

        for (let i = 0; i < batch.length; i++) {
          const v = vectors[i];
          if (!v) continue;
          if (v.length !== this.store.dim) {
            // The model produced a different width than the store was built
            // for; stop rather than writing rows that cannot be compared.
            this.emit('status', {
              status: 'error',
              error: `vector width ${v.length} != store ${this.store.dim}`,
            });
            return;
          }
          this.store.setVector(batch[i].row, v);
        }
        this.emit('indexed', this.store.stats());

        // Yield so capture, the UI and the reminder timers keep their turn.
        await new Promise((r) => setTimeout(r, IDLE_MS));
      }
    } finally {
      this.draining = false;
    }
  }

  /* ---------------- search ---------------- */

  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const q = String(query ?? '').trim();
    if (!q) return [];

    let vec: Float32Array | null = null;
    if (this.embedder.ready) {
      try {
        const [v] = await this.embedder.embed([q]);
        if (v && v.length === this.store.dim) vec = v;
      } catch {
        // Keyword-only is a perfectly good answer when the model is busy.
      }
    }

    return this.store.search(q, vec, opts).map((hit) => ({
      id: hit.rec.id,
      source: hit.rec.source,
      kind: hit.rec.kind,
      title: hit.rec.title,
      text: hit.rec.text,
      ts: hit.rec.ts,
      meta: hit.rec.meta,
      score: hit.score,
      matched:
        hit.vector !== null && hit.keyword !== null
          ? 'both'
          : hit.vector !== null
            ? 'meaning'
            : 'words',
    }));
  }

  recent(limit?: number, source?: string | null): SearchHit[] {
    return this.store.recent(limit, source ?? null).map((r) => ({
      id: r.id,
      source: r.source,
      kind: r.kind,
      title: r.title,
      text: r.text,
      ts: r.ts,
      meta: r.meta,
      score: 0,
      matched: 'words' as const,
    }));
  }

  forget(id: string): boolean {
    const ok = this.store.remove(id);
    if (ok) this.emit('indexed', this.store.stats());
    return ok;
  }

  forgetSource(source: string): number {
    let n = 0;
    for (const rec of [...this.store.rows]) {
      if (rec.source === source && this.store.remove(rec.id)) n++;
    }
    if (n) this.emit('indexed', this.store.stats());
    return n;
  }

  prune(opts: { days?: number | null; maxChunks?: number | null }): number {
    const n = this.store.prune(opts);
    if (n) this.emit('indexed', this.store.stats());
    return n;
  }

  compact(): number {
    const n = this.store.compact();
    this.emit('indexed', this.store.stats());
    return n;
  }

  stats(): MemoryStatsWithEmbedder {
    return { ...this.store.stats(), embedder: this.embedder.state() };
  }

  /** Swaps backends at runtime; existing vectors are invalidated if needed. */
  async setBackend(cfg: BackendConfig): Promise<MemoryStatsWithEmbedder> {
    this.embedder.stop();
    this.embedder.removeAllListeners();
    this.embedder = new Embedder({
      cacheDir: path.join(this.dir, 'models'),
      backend: cfg.backend ?? this.embedder.backend,
      provider: cfg.provider ?? this.embedder.provider,
      apiKey: cfg.apiKey ?? this.embedder.apiKey,
      allowDownload: this.settings.allowModelDownload !== false,
    });
    this.embedder.on('status', (s) => this.emit('status', s));
    this.wired = false;

    const dim = this.embedder.expectedDim();
    if (dim !== this.store.dim) {
      this.store.close();
      this.store = new MemoryStore(path.join(this.dir, 'memory'), dim).load();
    }
    await this.start();
    return this.stats();
  }

  stop(): void {
    this.stopped = true;
    this.embedder.stop();
    this.store.close();
  }
}
