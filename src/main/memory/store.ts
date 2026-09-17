import fs from 'fs';
import path from 'path';
import type { MemoryInput, MemoryRecord, MemoryStats, SearchOptions } from '../../types';

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
  (
    'a an and are as at be but by for from has have i in is it its of on or that the to was were will with you your this ' +
    'he she they them we us our my me do does did not no so if then than there here what when where who how all any can'
  ).split(' ')
);

/** Cheap, dependency-free tokenizer: lowercase, split, drop stopwords and plurals. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
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

/**
 * Below this cosine, MiniLM is telling us the texts are unrelated.
 *
 * Measured rather than guessed. Across question/document pairs for this
 * model, genuinely related pairs scored 0.12 to 0.46 and unrelated ones
 * -0.04 to 0.04, so the floor sits in the gap between the two. An earlier
 * value of 0.25 was inside the related range and silently dropped real
 * matches -- a paraphrased question would return nothing even though the
 * answer was indexed.
 */
export const MIN_COSINE = 0.1;

interface StoreMeta {
  dim: number;
  model: string | null;
  version: number;
}

/** A line in chunks.jsonl is either a record or a deletion marker. */
interface PersistedRecord extends Omit<MemoryRecord, 'row' | 'embedded'> {
  tombstone?: false;
}
interface Tombstone {
  id: string;
  tombstone: true;
}
type LogLine = PersistedRecord | Tombstone;

export interface Scored {
  rec: MemoryRecord;
  score: number;
  keyword: number | null;
  vector: number | null;
}

export class MemoryStore {
  readonly dir: string;
  readonly dim: number;
  private readonly chunkFile: string;
  private readonly vecFile: string;
  private readonly metaFile: string;

  rows: MemoryRecord[] = [];
  byId = new Map<string, MemoryRecord>();
  deleted = new Set<number>();
  private vecs = new Float32Array(0);
  private capacity = 0;

  private inverted = new Map<string, Map<number, number>>();
  private docLen: number[] = [];
  private avgLen = 0;

  meta: StoreMeta;
  private vecFd: number | null = null;

  /**
   * @param dir directory to keep the three files in
   * @param dim embedding width; a change forces a re-embed
   */
  constructor(dir: string, dim = 384) {
    this.dir = dir;
    this.dim = dim;
    this.chunkFile = path.join(dir, 'chunks.jsonl');
    this.vecFile = path.join(dir, 'vectors.bin');
    this.metaFile = path.join(dir, 'meta.json');
    this.meta = { dim, model: null, version: 1 };
  }

  /* ---------------- load ---------------- */

  load(): this {
    fs.mkdirSync(this.dir, { recursive: true });

    let stored: Partial<StoreMeta> | null = null;
    try {
      stored = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) as Partial<StoreMeta>;
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
      this.resetVectors();
      this.meta = { ...this.meta, ...(stored ?? {}), dim: this.dim, model: null };
      this.saveMeta();
    }

    this.loadChunks();
    this.ensureVectorFile();
    this.loadVectors();
    this.markEmbedded();
    this.rebuildIndex();
    return this;
  }

  private loadChunks(): void {
    let raw = '';
    try {
      raw = fs.readFileSync(this.chunkFile, 'utf8');
    } catch {
      return;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let parsed: LogLine;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        continue; // a torn final line from a hard kill -- skip it
      }

      if ('tombstone' in parsed && parsed.tombstone) {
        // A deletion marker refers to an earlier line; it is not a row of its
        // own. Replaying it as one would shift every subsequent row away from
        // its vector.
        const target = this.byId.get(parsed.id);
        if (target) this.deleted.add(target.row);
        continue;
      }

      const rec = parsed as MemoryRecord;
      rec.row = this.rows.length;
      this.rows.push(rec);
      this.byId.set(rec.id, rec);
    }
  }

  /**
   * Makes vectors.bin exactly as long as the chunk log.
   *
   * Without this, a model change deletes the file and the next setVector()
   * fails with ENOENT -- there is no append to recreate it unless something
   * new is captured first. It also repairs a file truncated by a hard kill,
   * and drops orphan rows left by an interrupted compaction.
   */
  private ensureVectorFile(): void {
    const needed = this.rows.length * this.dim * 4;
    let size = -1;
    try {
      size = fs.statSync(this.vecFile).size;
    } catch {
      size = -1;
    }
    if (size === needed) return;

    if (size < 0) fs.writeFileSync(this.vecFile, Buffer.alloc(needed));
    else if (size < needed) fs.appendFileSync(this.vecFile, Buffer.alloc(needed - size));
    else fs.truncateSync(this.vecFile, needed);
  }

  private loadVectors(): void {
    let buf: Buffer;
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
  private markEmbedded(): void {
    const dim = this.dim;
    for (const rec of this.rows) {
      const base = rec.row * dim;
      let filled = false;
      for (let i = 0; i < dim; i++) {
        if (this.vecs[base + i] !== 0) {
          filled = true;
          break;
        }
      }
      rec.embedded = filled;
    }
  }

  private resetVectors(): void {
    try {
      fs.rmSync(this.vecFile, { force: true });
    } catch {
      /* nothing to remove */
    }
    for (const r of this.rows) r.embedded = false;
  }

  /* ---------------- keyword index ---------------- */

  private rebuildIndex(): void {
    this.inverted = new Map();
    this.docLen = new Array<number>(this.rows.length).fill(0);
    let total = 0;

    for (const rec of this.rows) {
      if (this.deleted.has(rec.row)) continue;
      const toks = tokenize(`${rec.text} ${rec.title ?? ''}`);
      this.docLen[rec.row] = toks.length;
      total += toks.length;
      for (const t of toks) {
        let posting = this.inverted.get(t);
        if (!posting) this.inverted.set(t, (posting = new Map()));
        posting.set(rec.row, (posting.get(rec.row) ?? 0) + 1);
      }
    }
    const live = this.rows.length - this.deleted.size;
    this.avgLen = live > 0 ? total / live : 0;
  }

  private indexRow(rec: MemoryRecord): void {
    const toks = tokenize(`${rec.text} ${rec.title ?? ''}`);
    this.docLen[rec.row] = toks.length;
    for (const t of toks) {
      let posting = this.inverted.get(t);
      if (!posting) this.inverted.set(t, (posting = new Map()));
      posting.set(rec.row, (posting.get(rec.row) ?? 0) + 1);
    }
    const live = this.rows.length - this.deleted.size;
    this.avgLen = live > 0 ? (this.avgLen * (live - 1) + toks.length) / live : 0;
  }

  /* ---------------- writes ---------------- */

  private grow(needRows: number): void {
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
   */
  add(records: MemoryInput[]): MemoryRecord[] {
    if (!records.length) return [];
    const lines: string[] = [];
    const zeros = Buffer.alloc(this.dim * 4);
    const vecChunks: Buffer[] = [];
    const stored: MemoryRecord[] = [];

    this.grow(this.rows.length + records.length);

    for (const r of records) {
      const rec: MemoryRecord = {
        id: r.id,
        source: r.source,
        kind: r.kind ?? 'text',
        title: r.title ?? '',
        text: r.text,
        ts: r.ts ?? Date.now(),
        meta: r.meta ?? {},
        row: this.rows.length,
        embedded: false,
      };
      this.rows.push(rec);
      this.byId.set(rec.id, rec);
      // `row` and `embedded` are derived at load time, so they never go in
      // the log -- writing them would let the file disagree with the vectors.
      const { row: _row, embedded: _embedded, ...persisted } = rec;
      lines.push(JSON.stringify(persisted));
      vecChunks.push(zeros);
      this.indexRow(rec);
      stored.push(rec);
    }

    fs.appendFileSync(this.chunkFile, `${lines.join('\n')}\n`);
    fs.appendFileSync(this.vecFile, Buffer.concat(vecChunks));
    return stored;
  }

  /** Fills in a reserved vector slot, in memory and on disk. */
  setVector(row: number, vec: Float32Array): boolean {
    if (row < 0 || row >= this.rows.length) return false;
    if (vec.length !== this.dim) return false;

    this.vecs.set(vec, row * this.dim);

    if (this.vecFd === null) this.vecFd = fs.openSync(this.vecFile, 'r+');
    const buf = Buffer.from(vec.buffer, vec.byteOffset, this.dim * 4);
    fs.writeSync(this.vecFd, buf, 0, buf.length, row * this.dim * 4);

    this.rows[row].embedded = true;
    return true;
  }

  /** Rows still waiting on the embedder, oldest first. */
  pending(limit = 64): MemoryRecord[] {
    const out: MemoryRecord[] = [];
    for (const rec of this.rows) {
      if (rec.embedded || this.deleted.has(rec.row)) continue;
      out.push(rec);
      if (out.length >= limit) break;
    }
    return out;
  }

  remove(id: string): boolean {
    const rec = this.byId.get(id);
    if (!rec || this.deleted.has(rec.row)) return false;
    this.deleted.add(rec.row);
    // Tombstone in the log; compact() reclaims the space later.
    fs.appendFileSync(this.chunkFile, `${JSON.stringify({ id: rec.id, tombstone: true })}\n`);
    for (const posting of this.inverted.values()) posting.delete(rec.row);
    return true;
  }

  /* ---------------- search ---------------- */

  /** BM25 over the inverted index. */
  keywordSearch(query: string, k: number): Array<[number, number]> {
    const toks = tokenize(query);
    if (!toks.length) return [];
    const live = this.rows.length - this.deleted.size;
    const scores = new Map<number, number>();

    for (const t of toks) {
      const posting = this.inverted.get(t);
      if (!posting) continue;
      const idf = Math.log(1 + (live - posting.size + 0.5) / (posting.size + 0.5));
      for (const [row, tf] of posting) {
        if (this.deleted.has(row)) continue;
        const norm =
          (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (this.docLen[row] / (this.avgLen || 1))));
        scores.set(row, (scores.get(row) ?? 0) + idf * norm);
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
  vectorSearch(queryVec: Float32Array | null, k: number, floor = MIN_COSINE): Array<[number, number]> {
    if (!queryVec || queryVec.length !== this.dim) return [];
    const out: Array<[number, number]> = [];
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
  search(queryText: string, queryVec: Float32Array | null, opts: SearchOptions = {}): Scored[] {
    const { k = 8, pool = 60, since = null, source = null } = opts;
    const kw = this.keywordSearch(queryText, pool);
    const vec = queryVec ? this.vectorSearch(queryVec, pool) : [];

    const RRF_K = 60;
    const fused = new Map<number, number>();
    const bump = (list: Array<[number, number]>, weight: number): void => {
      list.forEach(([row], rank) => {
        fused.set(row, (fused.get(row) ?? 0) + weight / (RRF_K + rank + 1));
      });
    };
    bump(kw, 1.0);
    bump(vec, 1.0);

    const kwScore = new Map(kw);
    const vecScore = new Map(vec);

    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([row, score]) => ({
        rec: this.rows[row],
        score,
        keyword: kwScore.get(row) ?? null,
        vector: vecScore.get(row) ?? null,
      }))
      .filter(({ rec }) => {
        if (!rec || this.deleted.has(rec.row)) return false;
        if (since && rec.ts < since) return false;
        if (source && rec.source !== source) return false;
        return true;
      })
      .slice(0, k);
  }

  /**
   * Nearest neighbours of a chunk that is already stored.
   *
   * The row's own vector is the query, so this costs no embedding call at all
   * and keeps working while the model is downloading -- an unembedded row
   * simply has no neighbours yet.
   *
   * Chunks split from the same capture are dropped. They are the rest of the
   * same paragraph, they always score highest, and they would fill the list
   * with text the reader is already looking at.
   */
  related(id: string, k = 5, floor = MIN_COSINE): Scored[] {
    const rec = this.byId.get(id);
    if (!rec || !rec.embedded || this.deleted.has(rec.row)) return [];

    const query = this.vecs.subarray(rec.row * this.dim, (rec.row + 1) * this.dim);
    const sameCapture = id.includes('_') ? `${id.slice(0, id.lastIndexOf('_'))}_` : null;

    const out: Scored[] = [];
    // Over-fetch, because the siblings dropped below come off the top.
    for (const [row, score] of this.vectorSearch(query, k + 12, floor)) {
      const hit = this.rows[row];
      if (hit.row === rec.row) continue;
      if (sameCapture && hit.id.startsWith(sameCapture)) continue;
      out.push({ rec: hit, score, keyword: null, vector: score });
      if (out.length >= k) break;
    }
    return out;
  }

  recent(limit = 20, source: string | null = null): MemoryRecord[] {
    const out: MemoryRecord[] = [];
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
  prune({ days = null, maxChunks = null }: { days?: number | null; maxChunks?: number | null } = {}): number {
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
  compact(): number {
    const keep = this.rows.filter((r) => !this.deleted.has(r.row));
    const tmpChunks = `${this.chunkFile}.tmp`;
    const tmpVecs = `${this.vecFile}.tmp`;

    const vecOut = Buffer.alloc(keep.length * this.dim * 4);
    const lines = keep.map((rec, i) => {
      const src = new Float32Array(this.vecs.buffer, rec.row * this.dim * 4, this.dim);
      Buffer.from(src.buffer, src.byteOffset, this.dim * 4).copy(vecOut, i * this.dim * 4);
      const { row: _row, embedded: _embedded, ...rest } = rec;
      return JSON.stringify(rest);
    });

    fs.writeFileSync(tmpChunks, lines.length ? `${lines.join('\n')}\n` : '');
    fs.writeFileSync(tmpVecs, vecOut);
    this.closeFd();
    fs.renameSync(tmpChunks, this.chunkFile);
    fs.renameSync(tmpVecs, this.vecFile);

    this.rows = [];
    this.byId = new Map();
    this.deleted = new Set();
    this.loadChunks();
    this.ensureVectorFile();
    this.loadVectors();
    this.markEmbedded();
    this.rebuildIndex();
    return keep.length;
  }

  /**
   * Vectors from different models are not comparable even at the same width,
   * so switching backends has to invalidate them. The text is untouched and
   * the embedder refills the slots in the background.
   *
   * @returns true if a re-embed was triggered
   */
  ensureModel(modelId: string | null): boolean {
    if (!modelId || this.meta.model === modelId) return false;
    const hadVectors = this.rows.some((r) => r.embedded);
    this.resetVectors();
    this.vecs = new Float32Array(this.capacity * this.dim);
    fs.writeFileSync(this.vecFile, Buffer.alloc(this.rows.length * this.dim * 4));
    this.closeFd();
    for (const rec of this.rows) rec.embedded = false;
    this.saveMeta({ model: modelId });
    return hadVectors;
  }

  saveMeta(patch: Partial<StoreMeta> = {}): void {
    this.meta = { ...this.meta, ...patch, dim: this.dim };
    const tmp = `${this.metaFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.meta, null, 2));
    fs.renameSync(tmp, this.metaFile);
  }

  stats(): MemoryStats {
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

  private closeFd(): void {
    if (this.vecFd !== null) {
      try {
        fs.closeSync(this.vecFd);
      } catch {
        /* already gone */
      }
      this.vecFd = null;
    }
  }

  close(): void {
    this.closeFd();
  }
}
