'use strict';
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const { MemoryStore } = require('./store');
const { Embedder } = require('./embedder');
const { chunk, normalize } = require('./chunker');

const BATCH = 16;
const IDLE_MS = 120;

/**
 * The memory: capture goes in, search comes out.
 *
 * Capture and embedding are deliberately decoupled. Text is written to the
 * store the instant it arrives and is immediately findable by keyword; the
 * embedder fills in the vectors behind it, so a model that is still
 * downloading, or a cloud key that is missing, degrades search quality
 * instead of dropping data on the floor.
 */
class Memory extends EventEmitter {
  constructor({ dir, settings }) {
    super();
    this.dir = dir;
    this.settings = settings;

    this.embedder = new Embedder({
      cacheDir: path.join(dir, 'models'),
      backend: settings.embedBackend || 'local',
      provider: settings.embedProvider || 'gemini',
      apiKey: settings.embedApiKey || '',
      allowDownload: settings.allowModelDownload !== false,
    });

    this.store = new MemoryStore(path.join(dir, 'memory'), this.embedder.expectedDim()).load();

    this._draining = false;
    this._stopped = false;
    this._seen = new Map(); // content hash -> ts, for dedupe
    this._wired = false;

    this.embedder.on('status', (s) => this.emit('status', s));
  }

  async start() {
    await this.embedder.start().catch((e) => this.emit('status', { status: 'error', error: e.message }));

    if (this.embedder.ready) {
      // A different model means the stored vectors describe a different space.
      const reset = this.store.ensureModel(this.embedder.currentModel());
      if (reset) this.emit('status', { status: 'reindexing' });
      this._drain();
    }

    // The local backend becomes ready asynchronously, after a download.
    if (!this._wired) {
      this._wired = true;
      this.embedder.on('status', (s) => {
        if (s.status === 'ready') {
          this.store.ensureModel(this.embedder.currentModel());
          this._drain();
        }
      });
    }
    return this;
  }

  /* ---------------- capture ---------------- */

  /**
   * @param {object} item
   * @param {string} item.source  which capture source produced this
   * @param {string} item.text
   * @param {string} [item.title]
   * @param {string} [item.kind]
   * @param {object} [item.meta]
   * @returns {{added: number, skipped: string|null}}
   */
  capture(item) {
    const text = normalize(item.text);
    if (!text) return { added: 0, skipped: 'empty' };

    // Ambient sources re-send the same content constantly (a clipboard that
    // has not changed, a window title that repeats). Hash-dedupe within a
    // window so the store does not fill with copies.
    const hash = crypto.createHash('sha1').update(item.source + '|' + text).digest('hex');
    const seenAt = this._seen.get(hash);
    const now = Date.now();
    if (seenAt && now - seenAt < 6 * 3600000) return { added: 0, skipped: 'duplicate' };
    this._seen.set(hash, now);
    if (this._seen.size > 5000) {
      // Cheap bound: keep the newest half rather than tracking a real LRU.
      const entries = [...this._seen.entries()].sort((a, b) => b[1] - a[1]);
      this._seen = new Map(entries.slice(0, 2500));
    }

    const pieces = chunk(text);
    if (!pieces.length) return { added: 0, skipped: 'too-short' };

    const records = pieces.map((p, i) => ({
      id: `${hash.slice(0, 12)}_${i}`,
      source: item.source,
      kind: item.kind || 'text',
      title: item.title || '',
      text: p.text,
      ts: item.ts || now,
      meta: { ...(item.meta || {}), offset: p.offset, part: i, parts: pieces.length },
    }));

    // An id collision means identical content from the same source; skip it.
    const fresh = records.filter((r) => !this.store.byId.has(r.id));
    if (!fresh.length) return { added: 0, skipped: 'duplicate' };

    this.store.add(fresh);
    this.emit('captured', { source: item.source, chunks: fresh.length, title: item.title || '' });
    this._drain();
    return { added: fresh.length, skipped: null };
  }

  /* ---------------- embedding queue ---------------- */

  async _drain() {
    if (this._draining || this._stopped || !this.embedder.ready) return;
    this._draining = true;

    try {
      for (;;) {
        if (this._stopped) break;
        const batch = this.store.pending(BATCH);
        if (!batch.length) break;

        let vectors;
        try {
          vectors = await this.embedder.embed(batch.map((r) => r.text));
        } catch (err) {
          this.emit('status', { status: 'error', error: err.message });
          break; // retried on the next capture or restart
        }

        for (let i = 0; i < batch.length; i++) {
          const v = vectors[i];
          if (!v) continue;
          if (v.length !== this.store.dim) {
            // The model produced a different width than the store was built
            // for; stop rather than writing rows that cannot be compared.
            this.emit('status', { status: 'error', error: `vector width ${v.length} != store ${this.store.dim}` });
            return;
          }
          this.store.setVector(batch[i].row, v);
        }
        this.emit('indexed', this.store.stats());

        // Yield so capture, the UI and the reminder timers keep their turn.
        await new Promise((r) => setTimeout(r, IDLE_MS));
      }
    } finally {
      this._draining = false;
    }
  }

  /* ---------------- search ---------------- */

  /**
   * @param {string} query
   * @param {object} [opts] k, since, source
   */
  async search(query, opts = {}) {
    const q = String(query || '').trim();
    if (!q) return [];

    let vec = null;
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
        hit.vector !== null && hit.keyword !== null ? 'both' : hit.vector !== null ? 'meaning' : 'words',
    }));
  }

  recent(limit, source) {
    return this.store.recent(limit, source).map((r) => ({
      id: r.id,
      source: r.source,
      kind: r.kind,
      title: r.title,
      text: r.text,
      ts: r.ts,
      meta: r.meta,
    }));
  }

  forget(id) {
    const ok = this.store.remove(id);
    if (ok) this.emit('indexed', this.store.stats());
    return ok;
  }

  forgetSource(source) {
    let n = 0;
    for (const rec of [...this.store.rows]) {
      if (rec.source === source && this.store.remove(rec.id)) n++;
    }
    if (n) this.emit('indexed', this.store.stats());
    return n;
  }

  prune(opts) {
    const n = this.store.prune(opts);
    if (n) this.emit('indexed', this.store.stats());
    return n;
  }

  compact() {
    const n = this.store.compact();
    this.emit('indexed', this.store.stats());
    return n;
  }

  stats() {
    return { ...this.store.stats(), embedder: this.embedder.state() };
  }

  /** Swaps backends at runtime; existing vectors are invalidated if needed. */
  async setBackend({ backend, provider, apiKey }) {
    this.embedder.stop();
    this.embedder.removeAllListeners();
    this.embedder = new Embedder({
      cacheDir: path.join(this.dir, 'models'),
      backend: backend || this.embedder.backend,
      provider: provider || this.embedder.provider,
      apiKey: apiKey ?? this.embedder.apiKey,
      allowDownload: this.settings.allowModelDownload !== false,
    });
    this.embedder.on('status', (s) => this.emit('status', s));
    this._wired = false;

    const dim = this.embedder.expectedDim();
    if (dim !== this.store.dim) {
      this.store.close();
      this.store = new MemoryStore(path.join(this.dir, 'memory'), dim).load();
    }
    await this.start();
    return this.stats();
  }

  stop() {
    this._stopped = true;
    this.embedder.stop();
    this.store.close();
  }
}

module.exports = { Memory };
