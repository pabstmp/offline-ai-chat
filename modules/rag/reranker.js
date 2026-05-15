/* Reranker: calls a cross-encoder model via /v1/chat/completions to score query-chunk pairs. */

import { requestCompletion } from "../api.js";

/**
 * Rerank a candidate set using a cross-encoder model.
 *
 * @param {object} opts
 * @param {string} opts.query          - User query
 * @param {Array}  opts.chunks         - Candidate chunks from retriever
 * @param {object} opts.config         - Reranking config
 * @param {object} opts.embedConfig    - Connection info
 * @param {AbortSignal} [opts.signal]  - Abort signal
 * @returns {Promise<Array>}           - Same chunks, sorted by rerankScore desc
 */
export async function rerank({ query, chunks, config, embedConfig, signal }) {
  if (signal?.aborted) throw new Error("Reranking cancelado");
  
  if (!chunks || chunks.length === 0) return [];
  
  const finalK = config.finalK || 5;
  const candidateK = config.candidateK && config.candidateK >= finalK ? config.candidateK : finalK * 3;
  const candidates = chunks.slice(0, candidateK);
  
  const batchSize = config.rerankBatchSize && config.rerankBatchSize > 0 ? config.rerankBatchSize : 8;
  const baseUrl = config.rerankEndpoint ? config.rerankEndpoint : embedConfig.baseUrl;
  
  const scoredChunks = [];
  
  // Estratégia: paralelo dentro de cada lote (Promise.all) e sequencial entre
  // lotes (await por iteração). Lotes mantêm o LM Studio sob pressão controlada
  // — N=8 requests simultâneos, próximo lote só sai depois que o atual fecha.
  for (let i = 0; i < candidates.length; i += batchSize) {
    if (signal?.aborted) throw new Error("Reranking cancelado");

    const batch = candidates.slice(i, i + batchSize);

    const promises = batch.map(async (chunk) => {
      try {
        const textToScore = (chunk.text || "").slice(0, 2048);
        const prompt = `Relevance score (0-10) for query: '${query}'\nDocument: '${textToScore}'\nScore:`;
        
        const payload = {
          model: config.rerankModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 10,
        };
        
        const res = await requestCompletion({ baseUrl, apiKey: embedConfig.apiKey, payload, signal }, () => {});
        
        // extract numeric score
        const match = res.content.match(/[-+]?\d*\.?\d+/);
        let score = -Infinity;
        if (match) {
          score = parseFloat(match[0]);
          if (isNaN(score)) score = -Infinity;
        }
        return { ...chunk, rerankScore: score };
      } catch (err) {
        return { ...chunk, rerankScore: -Infinity };
      }
    });
    
    const results = await Promise.all(promises);
    scoredChunks.push(...results);
  }
  
  // Sort by rerankScore desc, then by original score desc
  scoredChunks.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) {
      return b.rerankScore - a.rerankScore;
    }
    return (b.score || 0) - (a.score || 0);
  });
  
  // Property: completude do reranker. Must return N chunks if N were given.
  // We sliced to candidateK initially. Let's return the un-reranked ones at the end if chunks > candidateK.
  const scoredIds = new Set(scoredChunks.map(c => c.id));
  const remaining = chunks.filter(c => !scoredIds.has(c.id)).map(c => ({ ...c, rerankScore: -Infinity }));
  
  return [...scoredChunks, ...remaining];
}
