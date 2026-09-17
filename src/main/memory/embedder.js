'use strict';
const path = require('path');
const { EventEmitter } = require('events');
const { utilityProcess, app, net } = require('electron');

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

const LOCAL_MODEL = 'Xenova/all-MiniLM-L6-v2';

const CLOUD = {
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
    parse: (json) => json.embeddings.map((e) => Float32Array.from(e.values)),
  },
  voyage: {
    id: 'voyage-3.5-lite',
    dim: 1024,
    url: 'https://api.voyageai.com/v1/embeddings',
    build: (texts) => ({ input: texts, model: 'voyage-3.5-lite', input_type: 'document' }),
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) => json.data.map((e) => Float32Array.from(e.embedding)),
  },
};

/** Cloud APIs do not all guarantee unit vectors; the store assumes they are. */
function normalize(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (n === 0 || Math.abs(n - 1) < 1e-6) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

class Embedder extends EventEmitter {
  constructor({ cacheDir, backend = 'local', provider = 'gemini', apiKey = '', allowDownload = true }) {
    super();
    this.cacheDir = cacheDir;
    this.backend = backend;
    this.provider = provider;
    this.apiKey = apiKey;
    this.allowDownload = allowDownload;

    this.child = null;
    this.ready = false;
    this.dim = 0;
    this.modelId = null;
    this.status = 'idle';
    this.progress = 0;
    this.lastError = null;

    this._seq = 0;
    this._waiting = new Map();
  }

  /** Model id that identifies this vector space, for the store's guard. */
  currentModel() {
    return this.backend === 'local' ? LOCAL_MODEL : `${this.provider}:${CLOUD[this.provider].id}`;
  }

  expectedDim() {
    return this.backend === 'local' ? 384 : CLOUD[this.provider].dim;
  }

  async start() {
    if (this.backend === 'cloud') {
      const spec = CLOUD[this.provider];
      if (!spec) throw new Error(`unknown provider: ${this.provider}`);
      this.ready = Boolean(this.apiKey);
      this.dim = spec.dim;
      this.modelId = this.currentModel();
      this._setStatus(this.ready ? 'ready' : 'needs-key');
      return this.ready;
    }
    return this._startLocal();
  }

  _setStatus(status, extra = {}) {
    this.status = status;
    this.emit('status', { status, dim: this.dim, model: this.modelId, progress: this.progress, error: this.lastError, ...extra });
  }

  _startLocal() {
    if (this.child) return Promise.resolve(this.ready);

    return new Promise((resolve) => {
      this._setStatus('loading');

      const script = path.join(__dirname, 'embed-worker.js');
      this.child = utilityProcess.fork(script, [], {
        serviceName: 'nibble-embedder',
        stdio: 'ignore',
      });

      this.child.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'progress') {
          this.progress = msg.pct;
          this._setStatus('downloading');
          return;
        }
        if (msg.type === 'ready') {
          this.ready = true;
          this.dim = msg.dim;
          this.modelId = msg.model;
          this.progress = 100;
          this.lastError = null;
          this._setStatus('ready');
          resolve(true);
          return;
        }
        if (msg.type === 'error') {
          this.lastError = msg.message;
          if (msg.id && this._waiting.has(msg.id)) {
            this._waiting.get(msg.id).reject(new Error(msg.message));
            this._waiting.delete(msg.id);
          } else {
            this._setStatus('error');
            resolve(false);
          }
          return;
        }
        if (msg.type === 'result') {
          const pending = this._waiting.get(msg.id);
          if (pending) {
            this._waiting.delete(msg.id);
            pending.resolve(msg.vectors);
          }
        }
      });

      this.child.on('exit', () => {
        this.child = null;
        this.ready = false;
        // Fail every in-flight batch rather than leaving callers hanging.
        for (const [, p] of this._waiting) p.reject(new Error('embedder stopped'));
        this._waiting.clear();
        if (this.status !== 'stopped') this._setStatus('stopped');
      });

      this.child.postMessage({
        type: 'init',
        cacheDir: this.cacheDir,
        model: LOCAL_MODEL,
        allowDownload: this.allowDownload,
      });
    });
  }

  /**
   * @param {string[]} texts
   * @returns {Promise<Float32Array[]>}
   */
  async embed(texts) {
    if (!texts.length) return [];
    if (this.backend === 'cloud') return this._embedCloud(texts);

    if (!this.ready) await this._startLocal();
    if (!this.ready) throw new Error(this.lastError || 'embedder not ready');

    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      this._waiting.set(id, { resolve, reject });
      this.child.postMessage({ type: 'embed', id, texts });
      // A wedged model should not pin the queue forever.
      setTimeout(() => {
        if (this._waiting.has(id)) {
          this._waiting.delete(id);
          reject(new Error('embed timed out'));
        }
      }, 120_000);
    });
  }

  async _embedCloud(texts) {
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
    const vectors = spec.parse(await res.json());
    return vectors.map(normalize);
  }

  stop() {
    this.status = 'stopped';
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.ready = false;
  }

  state() {
    return {
      backend: this.backend,
      provider: this.provider,
      hasKey: Boolean(this.apiKey),
      ready: this.ready,
      status: this.status,
      progress: this.progress,
      dim: this.dim || this.expectedDim(),
      model: this.modelId || this.currentModel(),
      error: this.lastError,
    };
  }
}

module.exports = { Embedder, LOCAL_MODEL, CLOUD };
