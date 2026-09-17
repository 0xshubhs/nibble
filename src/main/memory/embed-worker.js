'use strict';

/**
 * Runs the local embedding model in an Electron utilityProcess.
 *
 * Embedding a batch is tens of milliseconds of pure CPU. In the main process
 * that would stall the tray, the window and the reminder timers, so it lives
 * out here and talks over the parent port.
 *
 * Protocol (both directions are plain structured-clone messages):
 *   in : {type:'init', cacheDir, model, allowDownload}
 *        {type:'embed', id, texts:[string]}
 *   out: {type:'progress', pct, file}
 *        {type:'ready', model, dim}
 *        {type:'error', id?, message}
 *        {type:'result', id, dim, vectors:[Float32Array]}
 */

let extractor = null;
let ready = false;
let dim = 0;

const port = process.parentPort;

function send(msg) {
  try {
    port.postMessage(msg);
  } catch {
    /* parent went away; nothing useful to do here */
  }
}

async function init({ cacheDir, model, allowDownload }) {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');

    env.cacheDir = cacheDir;
    env.allowRemoteModels = allowDownload !== false;
    // Single-threaded WASM is irrelevant here (we use the native backend),
    // but pinning it avoids spawning a thread pool we never use.
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

    let lastPct = -1;
    extractor = await pipeline('feature-extraction', model, {
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        const pct = Math.round((p.loaded / p.total) * 100);
        // The callback fires per chunk; only report real movement.
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          send({ type: 'progress', pct, file: p.file || '' });
        }
      },
    });

    // Ask the model itself rather than hard-coding 384, so swapping the model
    // in settings cannot silently corrupt the vector file.
    const probe = await extractor('dimension probe', { pooling: 'mean', normalize: true });
    dim = probe.dims[probe.dims.length - 1];
    ready = true;
    send({ type: 'ready', model, dim });
  } catch (err) {
    send({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
}

async function embed({ id, texts }) {
  if (!ready) {
    send({ type: 'error', id, message: 'model not ready' });
    return;
  }
  try {
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const flat = out.data; // Float32Array of n * dim
    const vectors = [];
    for (let i = 0; i < texts.length; i++) {
      vectors.push(Float32Array.from(flat.subarray(i * dim, (i + 1) * dim)));
    }
    send({ type: 'result', id, dim, vectors });
  } catch (err) {
    send({ type: 'error', id, message: String(err && err.message ? err.message : err) });
  }
}

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'init') init(msg);
  else if (msg.type === 'embed') embed(msg);
});
