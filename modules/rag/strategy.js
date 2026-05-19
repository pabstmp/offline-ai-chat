/* Strategies for each detected intent and classifiers (Regex/LLM).
   Isolated from app.js to keep the entrypoint size manageable. */

import { requestCompletion } from "../api.js";

/**
 * Creates strategy objects defining retriever parameters for the query intent.
 * @param {string} mode - "comparative" | "summary" | "point"
 * @param {number} fileCount
 * @param {string} source - Classification method source label (for logging/debugging)
 */
export function makeStrategy(mode, fileCount, source) {
  if (mode === "comparative") {
    return {
      mode: "comparative",
      topK: Math.max(fileCount * 3, 14),
      maxPerFile: 3,
      includeFirstPerFile: true,
      coverAllFiles: true,
      exhaustive: true,
      hint: `comparativa — exaustivo (${fileCount} arquivos) [${source}]`,
    };
  }
  if (mode === "summary") {
    return {
      mode: "summary",
      topK: 8,
      maxPerFile: 4,
      hint: `resumo — chunks concentrados [${source}]`,
    };
  }
  return {
    mode: "point",
    topK: 5,
    maxPerFile: 2,
    hint: `pontual — top-5 [${source}]`,
  };
}

/**
 * Fast regex pre-pass. Catches obvious cases at zero cost (no LLM call).
 * Returns "comparative" | "summary" | null (= unsure, ask the LLM).
 */
export function intentFromRegex(query) {
  if (!query || typeof query !== "string") return null;
  const q = query.toLowerCase();

  const comparativePatterns = [
    /\bcompare\b/, /\bcomparar\b/, /\bcompara\b/,
    /\bliste\b/, /\blistar\b/, /\blista (de|dos|das|os|as)\b/,
    /\branking\b/, /\bordenar?\b/, /\borden[ae]\b/,
    /\bsoma\b/, /\btotal geral\b/, /\btotaliz/,
    /\bdiferen[çc]a\b/, /\bevolu[çc][aã]o\b/, /\bvaria[çc][aã]o\b/,
    /\btodos? os\b/, /\btodas? as\b/,
    /\bcada (arquivo|pdf|fatura|m[eê]s|um|uma|documento)\b/,
    /\bde cada\b/,
    /\bquantos?\b/, /\bquantas?\b/,
    /\bm[eê]s a m[eê]s\b/, /\bfatura por fatura\b/, /\barquivo por arquivo\b/,
    /\btabela por\b/,
    /\bmais (caro|cara|caros|caras|barato|barata|baratos|baratas|gasto|gastos|alto|alta|altos|altas|baixo|baixa|baixos|baixas)\b/,
    /\b(maior|menor) (gasto|valor|fatura|consumo|custo|despesa)\b/,
    /\b(quais?|que) (documentos?|arquivos?|pdfs?|faturas?|meses)\b/,
    /\b(documentos?|arquivos?|pdfs?|faturas?)\b.*\b(est[aã]o|existem|dispon[ií]ve[il]s?|indexad|na base|na pasta|no workspace)\b/,
    /\b(est[aã]o|existem|dispon[ií]ve[il]s?|indexad|na base|na pasta|no workspace)\b.*\b(documentos?|arquivos?|pdfs?|faturas?)\b/,
    /\b(qual|que) (m[eê]s|fatura|arquivo|pdf|recurso) mais\b/,
    /\bas faturas\b/, /\bos pdfs\b/, /\bos meses\b/, /\bos arquivos\b/, /\bos documentos\b/,
    /\b(valor|valores|custo|custos) (do|da|dos|das)\b.*\b(faturas|meses|arquivos|pdfs|recursos|documentos)\b/,
    /\b(faturas|meses|recursos|arquivos|documentos)\b.*\b(valor|valores|custo|custos|total|totais)\b/,
  ];
  if (comparativePatterns.some((re) => re.test(q))) return "comparative";

  const summaryPatterns = [
    /\bresuma\b/, /\bresumo\b/, /\bresumir\b/,
    /\bdo que (se )?trata\b/, /\bsobre o que\b/,
    /\bque cont[eé]m\b/, /\bo que (h[aá]|tem|cont[ée]m)\b/,
    /\bexplique\b/, /\bdetalhe\b/,
  ];
  if (summaryPatterns.some((re) => re.test(q))) return "summary";

  return null; // ambíguo — vai pro LLM
}

/**
 * Ask the loaded chat model to classify the query. Used when regex didn't match.
 * Returns "comparative" | "summary" | "point" | null (on failure).
 */
export async function intentFromLLM(query, fileCount, server, profile, store) {
  const startedAt = Date.now();
  try {
    const result = await requestCompletion({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      payload: {
        model: profile.defaultModel,
        stream: false,
        max_tokens: 8,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              `Você classifica perguntas de RAG em UMA palavra. Há ${fileCount} documento(s) indexado(s).\n` +
              `- "comparative": pede varrer/listar/comparar múltiplos documentos, totais, máximos, mínimos, ranking, evolução, diferenças.\n` +
              `- "summary": pede resumo/explicação geral de um documento.\n` +
              `- "point": busca um fato específico em um documento.\n` +
              `Responda APENAS uma palavra: comparative, summary, ou point.`,
          },
          { role: "user", content: query },
        ],
      },
    });
    const word = (result.content || "").trim().toLowerCase().replace(/[^a-z]/g, "");
    const elapsed = Date.now() - startedAt;
    if (["comparative", "summary", "point"].includes(word)) {
      if (store && store.get("advanced.debugMode")) {
        console.log(`[RAG] LLM classified "${query.slice(0, 50)}..." → ${word} (${elapsed}ms)`);
      }
      return word;
    }
    console.warn(`[RAG] LLM gave unexpected classification: "${word}" — falling back`);
    return null;
  } catch (err) {
    console.warn(`[RAG] LLM classifier failed: ${err.message} — falling back`);
    return null;
  }
}

/**
 * Detect query intent. Asks the loaded LLM to classify — handles any
 * phrasing, any language, no regex maintenance. Falls back to a regex
 * pre-pass only if the LLM is unreachable / model not loaded / timed out.
 * Final fallback: "comparative" (cobertura completa é mais seguro que
 * perder documentos). No caching: each query is classified fresh.
 */
export async function detectQueryStrategy(query, fileCount, server, profile, store) {
  const fromLLM = await intentFromLLM(query, fileCount, server, profile, store);
  if (fromLLM) return makeStrategy(fromLLM, fileCount, "llm");

  // LLM offline / não respondeu — tenta regex como heurística rápida
  const fromRegex = intentFromRegex(query);
  if (fromRegex) return makeStrategy(fromRegex, fileCount, "regex-fallback");

  // Tudo falhou: assume comparative (envia mais chunks, não perde info)
  return makeStrategy("comparative", fileCount, "fallback-safe");
}
