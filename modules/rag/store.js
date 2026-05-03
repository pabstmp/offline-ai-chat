/* Wraps storage.embeddingStore with rag-specific helpers. */

import { embeddingStore } from "../storage.js";

export async function saveChunks(sourceId, records) {
  /* records: [{id, sourceId, fileId, path, chunkIdx, text, lineStart, lineEnd, vec, dim}] */
  await embeddingStore.putBatch(records);
}

export async function loadAllChunks(sourceId) {
  const records = await embeddingStore.listBySource(sourceId);
  // Reconstruct Float32Array (IDB may serialize as plain arrays)
  return records.map((r) => ({
    ...r,
    vec: r.vec instanceof Float32Array ? r.vec : new Float32Array(r.vec),
  }));
}

export async function clearSource(sourceId) {
  await embeddingStore.deleteBySource(sourceId);
  await embeddingStore.deleteMeta(sourceId);
}

export async function getSourceMeta(sourceId) {
  return await embeddingStore.getMeta(sourceId);
}

export async function setSourceMeta(meta) {
  await embeddingStore.putMeta(meta);
}

export async function listAllMeta() {
  return await embeddingStore.listAllMeta();
}

export async function countChunks(sourceId) {
  return await embeddingStore.countBySource(sourceId);
}
