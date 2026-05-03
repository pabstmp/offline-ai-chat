/* Retriever — cosine similarity over Float32Array vectors.
   Vectors must be L2-normalized (embedder does this). Then cosine == dot. */

/**
 * Search top-K most similar chunks.
 * @param {Float32Array} queryVec - L2-normalized
 * @param {Array<{id, vec, fileId, chunkIdx, ...}>} chunks
 * @param {number} k
 * @param {object} opts
 * @param {number} [opts.maxPerFile] - max chunks per file (diversification)
 * @param {boolean} [opts.includeFirstPerFile] - always include chunkIdx=0 of each file
 * @param {boolean} [opts.coverAllFiles] - guarantee at least 1 chunk per file (overrides k if needed)
 * @returns {Array<{id, score, ...}>} sorted by score desc
 */
export function topK(queryVec, chunks, k = 5, opts = {}) {
  if (!queryVec || !chunks?.length) return [];
  const dim = queryVec.length;
  const maxPerFile = opts.maxPerFile || 0;
  const includeFirstPerFile = !!opts.includeFirstPerFile;
  const coverAllFiles = !!opts.coverAllFiles;

  // Score all chunks
  const scored = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c.vec || c.vec.length !== dim) {
      scored[i] = { ...c, score: -1 };
      continue;
    }
    scored[i] = { ...c, score: dot(queryVec, c.vec) };
  }
  scored.sort((a, b) => b.score - a.score);

  // "Cover all files" mode (comparative queries): the answer needs to mention
  // every document in the index. Pick 1 chunk per file FIRST (best-scored or
  // chunkIdx=0), then fill remaining slots with similar chunks. Bypasses pure
  // similarity ranking which can drop low-relevance files entirely.
  if (coverAllFiles) {
    const allFileIds = [...new Set(chunks.map((c) => c.fileId || c.path || "?"))];
    const result = [];
    const usedIds = new Set();

    for (const fid of allFileIds) {
      // Prefer first-chunk (chunkIdx=0 has document header/summary)
      let candidate = null;
      if (includeFirstPerFile) {
        candidate = scored.find((c) => (c.fileId || c.path || "?") === fid && c.chunkIdx === 0);
      }
      if (!candidate) {
        candidate = scored.find((c) => (c.fileId || c.path || "?") === fid);
      }
      if (candidate && !usedIds.has(candidate.id)) {
        result.push({ ...candidate, _reason: "all-files-coverage" });
        usedIds.add(candidate.id);
      }
    }

    // Now fill remaining slots (up to k) with best similar chunks not yet picked
    const perFileCount = new Map();
    for (const r of result) {
      const fid = r.fileId || r.path || "?";
      perFileCount.set(fid, (perFileCount.get(fid) || 0) + 1);
    }
    const targetK = Math.max(k, allFileIds.length);
    for (const c of scored) {
      if (result.length >= targetK) break;
      if (usedIds.has(c.id)) continue;
      const fid = c.fileId || c.path || "?";
      if (maxPerFile > 0 && (perFileCount.get(fid) || 0) >= maxPerFile) continue;
      result.push(c);
      usedIds.add(c.id);
      perFileCount.set(fid, (perFileCount.get(fid) || 0) + 1);
    }
    return result;
  }

  // Hybrid mode (comparative queries): always include first chunk of each file
  // because it contains the document summary/header. Then fill with best remaining.
  if (includeFirstPerFile) {
    const result = [];
    const usedIds = new Set();
    const seenFiles = new Set();

    const firstChunks = scored.filter((c) => c.chunkIdx === 0);
    firstChunks.sort((a, b) => b.score - a.score);
    for (const c of firstChunks) {
      if (result.length >= k) break;
      const fid = c.fileId || c.path || "?";
      if (seenFiles.has(fid)) continue;
      result.push({ ...c, _reason: "first-chunk" });
      usedIds.add(c.id);
      seenFiles.add(fid);
    }

    const perFileCount = new Map();
    for (const r of result) {
      const fid = r.fileId || r.path || "?";
      perFileCount.set(fid, (perFileCount.get(fid) || 0) + 1);
    }
    for (const c of scored) {
      if (result.length >= k) break;
      if (usedIds.has(c.id)) continue;
      const fid = c.fileId || c.path || "?";
      if (maxPerFile > 0 && (perFileCount.get(fid) || 0) >= maxPerFile) continue;
      result.push(c);
      usedIds.add(c.id);
      perFileCount.set(fid, (perFileCount.get(fid) || 0) + 1);
    }
    return result;
  }

  // No diversification — return raw top-K
  if (!maxPerFile || maxPerFile <= 0) {
    return scored.slice(0, Math.max(1, k));
  }

  // Diversified selection: limit chunks per fileId
  const result = [];
  const perFileCount = new Map();
  for (const c of scored) {
    if (result.length >= k) break;
    const fid = c.fileId || c.path || "?";
    const used = perFileCount.get(fid) || 0;
    if (used >= maxPerFile) continue;
    result.push(c);
    perFileCount.set(fid, used + 1);
  }

  // If we still have slots, fill with best remaining
  if (result.length < k) {
    const usedIds = new Set(result.map((r) => r.id));
    for (const c of scored) {
      if (result.length >= k) break;
      if (!usedIds.has(c.id)) result.push(c);
    }
  }
  return result;
}

/* Dot product of two equal-length Float32Array */
export function dot(a, b) {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
