import type { WorkerIn, WorkerOut } from './embedder';

/**
 * Runs the local embedding model in an Electron utilityProcess.
 *
 * Embedding a batch is tens of milliseconds of pure CPU. In the main process
 * that would stall the tray, the window and the reminder timers, so it lives
 * out here and talks over the parent port.
 */

type Extractor = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ dims: number[]; data: Float32Array }>;

let extractor: Extractor | null = null;
let ready = false;
let dim = 0;

const port = process.parentPort;

function send(msg: WorkerOut): void {
  try {
    port.postMessage(msg);
  } catch {
    /* parent went away; nothing useful to do here */
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function init(msg: Extract<WorkerIn, { type: 'init' }>): Promise<void> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');

    env.cacheDir = msg.cacheDir;
    env.allowRemoteModels = msg.allowDownload !== false;
    // Single-threaded WASM is irrelevant here (we use the native backend),
    // but pinning it avoids spawning a thread pool we never use.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

    let lastPct = -1;
    extractor = (await pipeline('feature-extraction', msg.model, {
      dtype: 'q8',
      progress_callback: (p: any) => {
        if (p.status !== 'progress' || !p.total) return;
        const pct = Math.round((p.loaded / p.total) * 100);
        // The callback fires per chunk; only report real movement.
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          send({ type: 'progress', pct, file: p.file ?? '' });
        }
      },
    })) as unknown as Extractor;

    // Ask the model itself rather than hard-coding 384, so swapping the model
    // in settings cannot silently corrupt the vector file.
    const probe = await extractor('dimension probe', { pooling: 'mean', normalize: true });
    dim = probe.dims[probe.dims.length - 1];
    ready = true;
    send({ type: 'ready', model: msg.model, dim });
  } catch (err) {
    send({ type: 'error', message: message(err) });
  }
}

async function embed(msg: Extract<WorkerIn, { type: 'embed' }>): Promise<void> {
  if (!ready || !extractor) {
    send({ type: 'error', id: msg.id, message: 'model not ready' });
    return;
  }
  try {
    const out = await extractor(msg.texts, { pooling: 'mean', normalize: true });
    const flat = out.data; // Float32Array of n * dim
    const vectors: Float32Array[] = [];
    for (let i = 0; i < msg.texts.length; i++) {
      vectors.push(Float32Array.from(flat.subarray(i * dim, (i + 1) * dim)));
    }
    send({ type: 'result', id: msg.id, dim, vectors });
  } catch (err) {
    send({ type: 'error', id: msg.id, message: message(err) });
  }
}

port.on('message', (e: Electron.MessageEvent) => {
  const msg = e.data as WorkerIn;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') void init(msg);
  else if (msg.type === 'embed') void embed(msg);
});
