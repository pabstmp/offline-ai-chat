/* RAG manager — high-level facade.
   Holds the current indexing job, exposes start/cancel/status, plus retrieval. */

import { indexSource } from "./indexer.js";
import { embedQuery } from "./embedder.js";
import { loadAllChunks, getSourceMeta, clearSource } from "./store.js";
import { topK } from "./retriever.js";

let activeJob = null; // { sourceId, abortController, lastProgress }
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(state) {
  subscribers.forEach((fn) => {
    try { fn(state); } catch (e) { console.error(e); }
  });
}

export function getJobStatus(sourceId) {
  if (activeJob && activeJob.sourceId === sourceId) {
    return { running: true, progress: activeJob.lastProgress };
  }
  return { running: false, progress: null };
}

export function isAnyJobRunning() {
  return !!activeJob;
}

export async function startIndexing({ source, embedConfig, workspace, ragConfig }) {
  if (activeJob) {
    throw new Error("Já existe uma indexação em andamento");
  }
  const abortController = new AbortController();
  activeJob = { sourceId: source.id, abortController, lastProgress: null };
  notify({ kind: "started", sourceId: source.id });

  try {
    const result = await indexSource({
      source, embedConfig, workspace, ragConfig,
      signal: abortController.signal,
      onProgress: (p) => {
        activeJob.lastProgress = p;
        notify({ kind: "progress", sourceId: source.id, progress: p });
      },
    });
    activeJob = null;
    notify({ kind: "done", sourceId: source.id, result });
    return result;
  } catch (err) {
    activeJob = null;
    notify({ kind: "error", sourceId: source.id, error: err.message });
    throw err;
  }
}

export function cancelIndexing(sourceId) {
  if (activeJob && activeJob.sourceId === sourceId) {
    activeJob.abortController.abort();
  }
}

export async function clearIndex(sourceId) {
  await clearSource(sourceId);
  notify({ kind: "cleared", sourceId });
}

export async function getStatus(sourceId) {
  const meta = await getSourceMeta(sourceId);
  return meta;
}

/* Retrieval — used by app at submit time.
   When `exhaustive` is true and the full index fits within `charBudget`,
   skips similarity search entirely and returns every chunk sorted by
   path+chunkIdx. This is the right answer for "list all", "compare", "total"
   style queries on small-to-medium indexes (where filtering by similarity
   risks dropping documents that the user explicitly asked about). */
export async function retrieve({
  sourceId,
  query,
  embedConfig,
  k = 5,
  maxPerFile = 0,
  includeFirstPerFile = false,
  coverAllFiles = false,
  exhaustive = false,
  charBudget = 100000,
}) {
  const meta = await getSourceMeta(sourceId);
  if (!meta) throw new Error("Fonte não indexada");
  if (meta.embeddingModel !== embedConfig.model) {
    throw new Error(
      `Fonte foi indexada com "${meta.embeddingModel}" mas configuração atual usa "${embedConfig.model}". Re-indexe pra continuar.`
    );
  }
  const chunks = await loadAllChunks(sourceId);

  if (exhaustive) {
    const totalChars = chunks.reduce((s, c) => s + (c.text?.length || 0), 0);
    if (totalChars <= charBudget) {
      // Fits in context — return everything ordered by file then chunk.
      const sorted = [...chunks].sort((a, b) => {
        const pa = a.path || a.fileId || "";
        const pb = b.path || b.fileId || "";
        if (pa !== pb) return pa.localeCompare(pb);
        return (a.chunkIdx || 0) - (b.chunkIdx || 0);
      });
      return sorted.map((c) => ({ ...c, score: 1, _reason: "exhaustive" }));
    }
    // Doesn't fit → fall through to similarity-based retrieval with coverAllFiles.
  }

  const queryVec = await embedQuery(query, {
    baseUrl: embedConfig.baseUrl,
    apiKey: embedConfig.apiKey,
    model: embedConfig.model,
  });
  return topK(queryVec, chunks, k, { maxPerFile, includeFirstPerFile, coverAllFiles });
}
