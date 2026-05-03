/* Embedder — calls /api/embeddings in batches.
   L2-normalizes vectors so cosine similarity == dot product. */

import { requestEmbeddings } from "../api.js";

/**
 * Embed an array of texts in batches.
 * @param {string[]} texts
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {number} opts.batchSize
 * @param {AbortSignal} [opts.signal]
 * @param {(done:number, total:number) => void} [opts.onProgress]
 * @returns {Promise<Float32Array[]>}
 */
export async function embedBatch(texts, opts) {
  const { baseUrl, apiKey, model, signal } = opts;
  let batchSize = Math.max(1, Math.min(opts.batchSize || 32, 128));
  const onProgress = opts.onProgress || (() => {});
  const out = new Array(texts.length);
  let done = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    if (signal?.aborted) throw new Error("Indexação cancelada");
    const slice = texts.slice(i, i + batchSize);
    let vecs;
    try {
      vecs = await embedSliceWithRetry({ baseUrl, apiKey, model, input: slice, signal });
    } catch (err) {
      // If a full batch fails, halve and retry the same range. Helps when a
      // big batch overflows the model's context or hits a transient timeout.
      if (batchSize > 1) {
        const newBatch = Math.max(1, Math.floor(batchSize / 2));
        console.warn(`[embedder] batch ${batchSize} falhou (${err.message}), reduzindo pra ${newBatch} e re-tentando o restante`);
        batchSize = newBatch;
        i -= batchSize; // retry from same i with new batchSize
        continue;
      }
      throw new Error(`Embedding falhou no chunk ${i} (batch=1): ${err.message}`);
    }
    if (vecs.length !== slice.length) {
      throw new Error(`Embedding retornou ${vecs.length} vetores para ${slice.length} inputs (chunk ${i})`);
    }
    for (let j = 0; j < vecs.length; j++) {
      out[i + j] = l2normalize(vecs[j]);
    }
    done += slice.length;
    onProgress(done, texts.length);
  }
  return out;
}

/* Retry helper with exponential backoff. Network blips and brief
   model-overload errors (HTTP 5xx) clear up within a few seconds. */
async function embedSliceWithRetry({ baseUrl, apiKey, model, input, signal }) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("Indexação cancelada");
    try {
      return await requestEmbeddings({ baseUrl, apiKey, model, input, signal });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastErr;
}

/* Single-text embedding for query time */
export async function embedQuery(text, opts) {
  const [vec] = await embedBatch([text], { ...opts, batchSize: 1 });
  return vec;
}

/* L2 normalize in place (returns same array) */
export function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  if (sum === 0) return vec;
  const inv = 1 / Math.sqrt(sum);
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  return vec;
}
