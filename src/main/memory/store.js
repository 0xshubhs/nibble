'use strict';
const fs = require('fs');
const path = require('path');

/**
 * The memory store: append-only text + a parallel vector file, with hybrid
 * keyword/semantic search over both.
 *
 * Deliberately has no native dependency. A SQLite build would mean a compiled
 * module per platform and architecture; this is two flat files and an index
 * rebuilt at load, which behaves identically on all three platforms.
 *
 *   chunks.jsonl   one JSON record per line, appended, never rewritten
 *   vectors.bin    fixed-width Float32 rows, row N belongs to line N
 *   meta.json      dim, model, and the tombstones
 *
 * A chunk is written the moment it is captured, with a zeroed vector slot that
 * the embedder fills in later -- so nothing is lost if the model is still
 * downloading or the app quits mid-batch.
 */

const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have i in is it its of on or that the to was were will with you your this ' +
   'he she they them we us our my me do does did not no so if then than there here what when where who how all any can').split(' ')
);

/** Cheap, dependency-free tokenizer: lowercase, split, drop stopwords and plurals. */
function tokenize(text) {
  const out = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length < 2 || raw.length > 40) continue;
    if (STOPWORDS.has(raw)) continue;
    // Crude stemming so "reminders" matches "reminder".
    out.push(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

const K1 = 1.2;
const B = 0.75;

// Below this cosine, MiniLM is telling us the texts are unrelated.
const MIN_COSINE = 0.25;

class MemoryStore {
  /**
   * @param {string} dir  directory to keep the three files in
   * @param {number} dim  embedding width; a change forces a re-embed
   */
  constructor(dir, dim = 384) {
    this.dir = dir;
    this.dim = dim;
    this.chunkFile = path.join(dir, 'chunks.jsonl');
    this.vecFile = path.join(dir, 'vectors.bin');
    this.metaFile = path.join(dir, 'meta.json');

    this.rows = [];          // chunk records, index === row number
    this.byId = new Map();
    this.deleted = new Set(); // row numbers
    this.vecs = new Float32Array(0);
    this.capacity = 0;

    this.inverted = new Map(); // token -> Map(row -> termFrequency)
    this.docLen = [];
    this.avgLen = 0;

    this.meta = { dim, model: null, version: 1 };
    this._vecFd = null;
  }

  /* ---------------- load ---------------- */

  load() {
    fs.mkdirSync(this.dir, { recursive: true });

    let stored = null;
    try {
      stored = JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      stored = null; // first run, or a meta file we cannot read
    }

    if (stored && stored.dim === this.dim) {
      this.meta = { ...this.meta, ...stored };
    } else {
      // Either the model width changed, or there is no meta file and the
      // vectors are of unknown provenance. Both make the existing vectors
      // unreadable, so drop them -- the captured text survives and gets
      // re-embedded in the background.
      this._resetVectors();
      this.meta = { ...this.meta, ...(stored || {}), dim: this.dim, model: null };
      this.saveMeta();
    }

    this._loadChunks();
    this._loadVectors();
    this._markEmbedded();
    this._rebuildIndex();
    return this;
  }

  _loadChunks() {
    let raw = '';
    try {
      raw = fs.readFileSync(this.chunkFile, 'utf8');
    } catch {
      return;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // a torn final line from a hard kill -- skip it
      }
      if (rec.tombstone) {
        // A deletion marker refers to an earlier line; it is not a row of its
        // own. Replaying it as one would shift every subsequent row away from
        // its vector.
        const target = this.byId.get(rec.id);
        if (target) this.deleted.add(target.row);
        continue;
      }
      rec.row = this.rows.length;
      this.rows.push(rec);
      this.byId.set(rec.id, rec);
    }
  }

  _loadVectors() {
    let buf;
    try {
      buf = fs.readFileSync(this.vecFile);
    } catch {
      buf = Buffer.alloc(0);
    }
    const rowsInFile = Math.floor(buf.length / (this.dim * 4));
    this.capacity = Math.max(this.rows.length, rowsInFile);
    this.vecs = new Float32Array(this.capacity * this.dim);
    // Copy through a same-length view so a truncated file cannot overrun.
    const usable = Math.min(rowsInFile, this.capacity) * this.dim;
    const view = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
    this.vecs.set(view.subarray(0, usable));
  }

  /**
   * A reserved slot is all zeros; a real embedding is normalized to unit
   * length and so can never be. Deriving the flag this way means the log and
   * the vector file can never drift apart, whenever the app was killed.
   */
  _markEmbedded() {
    const dim = this.dim;
    for (const rec of this.rows) {
      const base = rec.row * dim;
      let filled = false;
      for (let i = 0; i < dim; i++) {
        if (this.vecs[base + i] !== 0) { filled = true; break; }
      }
      rec.embedded = filled;
    }
  }

  _resetVectors() {
    try {
      fs.rmSync(this.vecFile, { force: true });
    } catch { /* nothing to remove */ }
    for (const r of this.rows) r.embedded = false;
  }

  /* ---------------- keyword index ---------------- */

  _rebuildIndex() {
    this.inverted = new Map();
    this.docLen = new Array(this.rows.length).fill(0);
    let total = 0;

    for (const rec of this.rows) {
      if (this.deleted.has(rec.row)) continue;
      const toks = tokenize(rec.text + ' ' + (rec.title || ''));
      this.docLen[rec.row] = toks.length;
      total += toks.length;
      for (const t of toks) {
        let posting = this.inverted.get(t);
        if (!posting) this.inverted.set(t, (posting = new Map()));
        posting.set(rec.row, (posting.get(rec.row) || 0) + 1);
      }
    }
    const live = this.rows.length - this.deleted.size;
    this.avgLen = live > 0 ? total / live : 0;
  }

  _indexRow(rec) {
    const toks = tokenize(rec.text + ' ' + (rec.title || ''));
    this.docLen[rec.row] = toks.length;
    for (const t of toks) {
      let posting = this.inverted.get(t);
      if (!posting) this.inverted.set(t, (posting = new Map()));
      posting.set(rec.row, (posting.get(rec.row) || 0) + 1);
    }
    const live = this.rows.length - this.deleted.size;
    this.avgLen = live > 0 ? (this.avgLen * (live - 1) + toks.length) / live : 0;
  }

  /* ---------------- writes ---------------- */

  _grow(needRows) {
    if (needRows <= this.capacity) return;
    const next = Math.max(needRows, Math.ceil(this.capacity * 1.6) || 256);
    const bigger = new Float32Array(next * this.dim);
    bigger.set(this.vecs);
    this.vecs = bigger;
    this.capacity = next;
  }

  /**
   * Appends chunks. Vectors are reserved as zeroed rows and filled in later
   * by setVector(), so capture never blocks on the model.
   * @returns {Array<object>} the stored records, each carrying its row number
   */
  add(records) {
    if (!records.length) return [];
    const lines = [];
    const zeros = Buffer.alloc(this.dim * 4);
    const vecChunks = [];
    const stored = [];

    this._grow(this.rows.length + records.length);

    for (const r of records) {
      const rec = {
        id: r.id,
        source: r.source,
        kind: r.kind || 'text',
        title: r.title || '',
        text: r.text,
        ts: r.ts || Date.now(),
        meta: r.meta || {},
        embedded: false,
      };
      rec.row = this.rows.length;
      this.rows.push(rec);
      this.byId.set(rec.id, rec);
      // `row` and `embedded` are derived at load time, so they never go in
      // the log -- writing them would let the file disagree with the vectors.
      const { row, embedded, ...persisted } = rec;
      lines.push(JSON.stringify(persisted));
      vecChunks.push(zeros);
      this._indexRow(rec);
      stored.push(rec);
    }

    fs.appendFileSync(this.chunkFile, lines.join('\n') + '\n');
    fs.appendFileSync(this.vecFile, Buffer.concat(vecChunks));
    return stored;
  }

  /** Fills in a reserved vector slot, in memory and on disk. */
  setVector(row, vec) {
    if (row < 0 || row >= this.rows.length) return false;
    if (vec.length !== this.dim) return false;

    this.vecs.set(vec, row * this.dim);

    if (this._vecFd === null) this._vecFd = fs.openSync(this.vecFile, 'r+');
    const buf = Buffer.from(vec.buffer, vec.byteOffset, this.dim * 4);
    fs.writeSync(this._vecFd, buf, 0, buf.length, row * this.dim * 4);

    this.rows[row].embedded = true;
    return true;
  }

  /** Rows still waiting on the embedder, oldest first. */
  pending(limit = 64) {
    const out = [];
    for (const rec of this.rows) {
      if (rec.embedded || this.deleted.has(rec.row)) continue;
      out.push(rec);
      if (out.length >= limit) break;
    }
    return out;
  }

  remove(id) {
    const rec = this.byId.get(id);
    if (!rec || this.deleted.has(rec.row)) return false;
    this.deleted.add(rec.row);
    // Tombstone in the log; compact() reclaims the space later.
    fs.appendFileSync(this.chunkFile, JSON.stringify({ id: rec.id, tombstone: true }) + '\n');
    for (const posting of this.inverted.values()) posting.delete(rec.row);
    return true;
  }

  /* ---------------- search ---------------- */

  /** BM25 over the inverted index. @returns {Array<[row, score]>} */
  keywordSearch(query, k) {
    const toks = tokenize(query);
    if (!toks.length) return [];
    const live = this.rows.length - this.deleted.size;
    const scores = new Map();

    for (const t of toks) {
      const posting = this.inverted.get(t);
      if (!posting) continue;
      const idf = Math.log(1 + (live - posting.size + 0.5) / (posting.size + 0.5));
      for (const [row, tf] of posting) {
        if (this.deleted.has(row)) continue;
        const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (this.docLen[row] / (this.avgLen || 1))));
        scores.set(row, (scores.get(row) || 0) + idf * norm);
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }

  /**
   * Cosine similarity. Vectors are stored normalized, so this is a dot product.
   *
   * Anything below `floor` is dropped rather than ranked. Without it every
   * query returns the whole corpus in some order, which looks like a search
   * engine that cannot say "no results" -- with MiniLM, a cosine under ~0.25
   * means the two texts are simply unrelated.
   */
  vectorSearch(queryVec, k, floor = MIN_COSINE) {
    if (!queryVec || queryVec.length !== this.dim) return [];
    const out = [];
    const dim = this.dim;

    for (const rec of this.rows) {
      if (!rec.embedded || this.deleted.has(rec.row)) continue;
      const base = rec.row * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += this.vecs[base + i] * queryVec[i];
      if (dot < floor) continue;
      out.push([rec.row, dot]);
    }
    out.sort((a, b) => b[1] - a[1]);
    return out.slice(0, k);
  }

  /**
   * Hybrid search, fused with Reciprocal Rank Fusion.
   *
   * RRF combines rankings rather than scores, so BM25's unbounded values and
   * cosine's [-1,1] never have to be put on a common scale -- and a result
   * that both methods like outranks one that only a single method loves.
   */
  search(queryText, queryVec, { k = 8, pool = 60, since = null, source = null } = {}) {
    const kw = this.keywordSearch(queryText, pool);
    const vec = queryVec ? this.vectorSearch(queryVec, pool) : [];

    const RRF_K = 60;
    const fused = new Map();
    const bump = (list, weight) => {
      list.forEach(([row], rank) => {
        fused.set(row, (fused.get(row) || 0) + weight / (RRF_K + rank + 1));
      });
    };
    bump(kw, 1.0);
    bump(vec, 1.0);

    const kwScore = new Map(kw);
    const vecScore = new Map(vec);

    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([row, score]) => ({ rec: this.rows[row], score, keyword: kwScore.get(row) ?? null, vector: vecScore.get(row) ?? null }))
      .filter(({ rec }) => {
        if (!rec || this.deleted.has(rec.row)) return false;
        if (since && rec.ts < since) return false;
        if (source && rec.source !== source) return false;
        return true;
      })
      .slice(0, k);
  }

  recent(limit = 20, source = null) {
    const out = [];
    for (let i = this.rows.length - 1; i >= 0 && out.length < limit; i--) {
      const rec = this.rows[i];
      if (this.deleted.has(rec.row)) continue;
      if (source && rec.source !== source) continue;
      out.push(rec);
    }
    return out;
  }

  /* ---------------- maintenance ---------------- */

  /** Drops anything older than `days`, keeping at most `maxChunks` rows. */
  prune({ days = null, maxChunks = null } = {}) {
    let removed = 0;
    if (days) {
      const cutoff = Date.now() - days * 86400000;
      for (const rec of this.rows) {
        if (!this.deleted.has(rec.row) && rec.ts < cutoff && this.remove(rec.id)) removed++;
      }
    }
    if (maxChunks) {
      let live = this.rows.length - this.deleted.size;
      for (const rec of this.rows) {
        if (live <= maxChunks) break;
        if (!this.deleted.has(rec.row) && this.remove(rec.id)) {
          removed++;
          live--;
        }
      }
    }
    return removed;
  }

  /** Rewrites both files without the tombstoned rows, then reloads. */
  compact() {
    const keep = this.rows.filter((r) => !this.deleted.has(r.row));
    const tmpChunks = this.chunkFile + '.tmp';
    const tmpVecs = this.vecFile + '.tmp';

    const vecOut = Buffer.alloc(keep.length * this.dim * 4);
    const lines = keep.map((rec, i) => {
      const src = new Float32Array(this.vecs.buffer, rec.row * this.dim * 4, this.dim);
      Buffer.from(src.buffer, src.byteOffset, this.dim * 4).copy(vecOut, i * this.dim * 4);
      const { row, ...rest } = rec;
      return JSON.stringify(rest);
    });

    fs.writeFileSync(tmpChunks, lines.length ? lines.join('\n') + '\n' : '');
    fs.writeFileSync(tmpVecs, vecOut);
    this._closeFd();
    fs.renameSync(tmpChunks, this.chunkFile);
    fs.renameSync(tmpVecs, this.vecFile);

    this.rows = [];
    this.byId = new Map();
    this.deleted = new Set();
    this._loadChunks();
    this._loadVectors();
    this._markEmbedded();
    this._rebuildIndex();
    return keep.length;
  }

  /**
   * Vectors from different models are not comparable even at the same width,
   * so switching backends has to invalidate them. The text is untouched and
   * the embedder refills the slots in the background.
   * @returns {boolean} true if a re-embed was triggered
   */
  ensureModel(modelId) {
    if (!modelId || this.meta.model === modelId) return false;
    const hadVectors = this.rows.some((r) => r.embedded);
    this._resetVectors();
    this.vecs = new Float32Array(this.capacity * this.dim);
    fs.writeFileSync(this.vecFile, Buffer.alloc(this.rows.length * this.dim * 4));
    this._closeFd();
    for (const rec of this.rows) rec.embedded = false;
    this.saveMeta({ model: modelId });
    return hadVectors;
  }

  saveMeta(patch = {}) {
    this.meta = { ...this.meta, ...patch, dim: this.dim };
    const tmp = this.metaFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.meta, null, 2));
    fs.renameSync(tmp, this.metaFile);
  }

  stats() {
    const live = this.rows.length - this.deleted.size;
    let embedded = 0;
    let bytes = 0;
    for (const rec of this.rows) {
      if (this.deleted.has(rec.row)) continue;
      if (rec.embedded) embedded++;
      bytes += rec.text.length;
    }
    return {
      chunks: live,
      embedded,
      pending: live - embedded,
      tombstones: this.deleted.size,
      textBytes: bytes,
      vectorBytes: live * this.dim * 4,
      model: this.meta.model,
      dim: this.dim,
    };
  }

  _closeFd() {
    if (this._vecFd !== null) {
      try { fs.closeSync(this._vecFd); } catch { /* already gone */ }
      this._vecFd = null;
    }
  }

  close() {
    this._closeFd();
  }
}

module.exports = { MemoryStore, tokenize, MIN_COSINE };
