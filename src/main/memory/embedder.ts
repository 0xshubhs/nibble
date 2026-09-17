import path from 'path';
import { EventEmitter } from 'events';
import { utilityProcess, net } from 'electron';
import type { EmbedBackend, EmbedProvider, EmbedderState, StatusEvent } from '../../types';

/**
 * Turns text into vectors, through one of two backends.
 *
 *   local  a quantized MiniLM running in a utility process. ~23MB, downloaded
 *          once, then entirely offline. This is the default, because the whole
 *          promise of the memory is that it does not leave the machine.
 *   cloud  Gemini or Voyage over HTTPS, for people who want the better recall
 *          and accept that their text is sent to a third party.
 *
 * Both expose the same call and both report the width they produce, which the
 * store uses to decide whether existing vectors are still valid.
 */

export const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

interface CloudSpec {
  id: string;
  dim: number;
  url: string;
  build(texts: string[]): unknown;
  headers(key: string): Record<string, string>;
  parse(json: any): Float32Array[];
}

export const CLOUD: Record<EmbedProvider, CloudSpec> = {
  gemini: {
    id: 'gemini-embedding-001',
    dim: 768,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    build: (texts) => ({
      requests: texts.map((t) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: t }] },
        outputDimensionality: 768,
      })),
    }),
    headers: (key) => ({ 'x-goog-api-key': key }),
    parse: (json) => json.embeddings.map((e: { values: number[] }) => Float32Array.from(e.values)),
  },
  voyage: {
    id: 'voyage-3.5-lite',
    dim: 1024,
    url: 'https://api.voyageai.com/v1/embeddings',
    build: (texts) => ({ input: texts, model: 'voyage-3.5-lite', input_type: 'document' }),
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) => json.data.map((e: { embedding: number[] }) => Float32Array.from(e.embedding)),
  },
};

/** Cloud APIs do not all guarantee unit vectors; the store assumes they are. */
function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (n === 0 || Math.abs(n - 1) < 1e-6) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/* ---------------- worker protocol ---------------- */

export type WorkerIn =
  | { type: 'init'; cacheDir: string; model: string; allowDownload: boolean }
  | { type: 'embed'; id: number; texts: string[] };

export type WorkerOut =
  | { type: 'progress'; pct: number; file: string }
  | { type: 'ready'; model: string; dim: number }
  | { type: 'error'; id?: number; message: string }
  | { type: 'result'; id: number; dim: number; vectors: Float32Array[] };

export interface EmbedderOptions {
  cacheDir: string;
  backend?: EmbedBackend;
  provider?: EmbedProvider;
  apiKey?: string;
  allowDownload?: boolean;
}

interface EmbedderEvents {
  status: [EmbedderState & StatusEvent];
}

interface Pending {
  resolve(vectors: Float32Array[]): void;
  reject(err: Error): void;
}

export class Embedder extends EventEmitter<EmbedderEvents> {
  readonly cacheDir: string;
  readonly backend: EmbedBackend;
  readonly provider: EmbedProvider;
  readonly apiKey: string;
  private readonly allowDownload: boolean;

  private child: Electron.UtilityProcess | null = null;
  ready = false;
  dim = 0;
  modelId: string | null = null;
  status = 'idle';
  progress = 0;
  lastError: string | null = null;

  private seq = 0;
  private waiting = new Map<number, Pending>();

  constructor(opts: EmbedderOptions) {
    super();
    this.cacheDir = opts.cacheDir;
    this.backend = opts.backend ?? 'local';
    this.provider = opts.provider ?? 'gemini';
    this.apiKey = opts.apiKey ?? '';
    this.allowDownload = opts.allowDownload !== false;
  }

  /** Model id that identifies this vector space, for the store's guard. */
  currentModel(): string {
    return this.backend === 'local' ? LOCAL_MODEL : `${this.provider}:${CLOUD[this.provider].id}`;
  }

  expectedDim(): number {
    return this.backend === 'local' ? 384 : CLOUD[this.provider].dim;
  }

  async start(): Promise<boolean> {
    if (this.backend === 'cloud') {
      const spec = CLOUD[this.provider];
      if (!spec) throw new Error(`unknown provider: ${this.provider}`);
      this.ready = Boolean(this.apiKey);
      this.dim = spec.dim;
      this.modelId = this.currentModel();
      this.setStatus(this.ready ? 'ready' : 'needs-key');
      return this.ready;
    }
    return this.startLocal();
  }

  private setStatus(status: string): void {
    this.status = status;
    this.emit('status', { ...this.state(), status });
  }

  private startLocal(): Promise<boolean> {
    if (this.child) return Promise.resolve(this.ready);

    return new Promise<boolean>((resolve) => {
      this.setStatus('loading');

      const script = path.join(__dirname, 'embed-worker.js');
      this.child = utilityProcess.fork(script, [], {
        serviceName: 'nibble-embedder',
        stdio: 'ignore',
      });

      this.child.on('message', (msg: WorkerOut) => {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'progress') {
          this.progress = msg.pct;
          this.setStatus('downloading');
          return;
        }
        if (msg.type === 'ready') {
          this.ready = true;
          this.dim = msg.dim;
          this.modelId = msg.model;
          this.progress = 100;
          this.lastError = null;
          this.setStatus('ready');
          resolve(true);
          return;
        }
        if (msg.type === 'error') {
          this.lastError = msg.message;
          const pending = msg.id !== undefined ? this.waiting.get(msg.id) : undefined;
          if (pending && msg.id !== undefined) {
            pending.reject(new Error(msg.message));
            this.waiting.delete(msg.id);
          } else {
            this.setStatus('error');
            resolve(false);
          }
          return;
        }
        if (msg.type === 'result') {
          const pending = this.waiting.get(msg.id);
          if (pending) {
            this.waiting.delete(msg.id);
            pending.resolve(msg.vectors);
          }
        }
      });

      this.child.on('exit', () => {
        this.child = null;
        this.ready = false;
        // Fail every in-flight batch rather than leaving callers hanging.
        for (const [, p] of this.waiting) p.reject(new Error('embedder stopped'));
        this.waiting.clear();
        if (this.status !== 'stopped') this.setStatus('stopped');
      });

      const init: WorkerIn = {
        type: 'init',
        cacheDir: this.cacheDir,
        model: LOCAL_MODEL,
        allowDownload: this.allowDownload,
      };
      this.child.postMessage(init);
    });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    if (this.backend === 'cloud') return this.embedCloud(texts);

    if (!this.ready) await this.startLocal();
    if (!this.ready || !this.child) throw new Error(this.lastError ?? 'embedder not ready');

    const id = ++this.seq;
    const child = this.child;
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      const msg: WorkerIn = { type: 'embed', id, texts };
      child.postMessage(msg);
      // A wedged model should not pin the queue forever.
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error('embed timed out'));
        }
      }, 120_000);
    });
  }

  private async embedCloud(texts: string[]): Promise<Float32Array[]> {
    const spec = CLOUD[this.provider];
    if (!this.apiKey) throw new Error('no API key set for the cloud embedder');

    const res = await net.fetch(spec.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...spec.headers(this.apiKey) },
      body: JSON.stringify(spec.build(texts)),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${this.provider} embeddings failed (${res.status}): ${body.slice(0, 200)}`);
    }
    return spec.parse(await res.json()).map(normalize);
  }

  stop(): void {
    this.status = 'stopped';
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.ready = false;
  }

  state(): EmbedderState {
    return {
      backend: this.backend,
      provider: this.provider,
      hasKey: Boolean(this.apiKey),
      ready: this.ready,
      status: this.status,
      progress: this.progress,
      dim: this.dim || this.expectedDim(),
      model: this.modelId ?? this.currentModel(),
      error: this.lastError,
    };
  }
}
