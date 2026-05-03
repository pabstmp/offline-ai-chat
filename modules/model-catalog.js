/* Curated catalog of popular offline LLM models for LM Studio (May 2026).
   Each entry includes recommended VRAM and capabilities. */

export const CATALOG = [
  // ===== Tier: 4-6 GB VRAM =====
  {
    id: "phi-4-mini",
    family: "Phi-4",
    name: "Phi-4-mini",
    params: 3.8,
    quant: "Q4_K_M",
    fileSizeGB: 2.4,
    minVramGB: 3,
    recommendedVramGB: 5,
    contextWindow: 128_000,
    strengths: ["geral", "rápido", "raciocínio"],
    thinking: true,
    notes: "Único viável em hardware fraco. Microsoft, qualidade impressionante pro tamanho. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "phi-4-mini gguf",
    category: "general",
  },
  {
    id: "llama-3.2-3b",
    family: "Llama",
    name: "Llama 3.2 3B Instruct",
    params: 3,
    quant: "Q4_K_M",
    fileSizeGB: 2.0,
    minVramGB: 3,
    recommendedVramGB: 4,
    contextWindow: 128_000,
    strengths: ["leve", "multilíngue"],
    notes: "Bom equilíbrio entre tamanho e qualidade.",
    lmStudioSearch: "llama-3.2-3b-instruct gguf",
    category: "general",
  },
  {
    id: "qwen-2.5-3b",
    family: "Qwen",
    name: "Qwen 2.5 3B",
    params: 3,
    quant: "Q4_K_M",
    fileSizeGB: 1.9,
    minVramGB: 3,
    recommendedVramGB: 4,
    contextWindow: 128_000,
    strengths: ["multilíngue", "código leve"],
    notes: "Alibaba. Bom em chinês/inglês/PT.",
    lmStudioSearch: "qwen2.5-3b-instruct gguf",
    category: "general",
  },

  // ===== Tier: 8 GB VRAM =====
  {
    id: "llama-3.1-8b",
    family: "Llama",
    name: "Llama 3.1 8B Instruct",
    params: 8,
    quant: "Q4_K_M",
    fileSizeGB: 4.9,
    minVramGB: 6,
    recommendedVramGB: 8,
    contextWindow: 128_000,
    strengths: ["geral", "raciocínio"],
    notes: "Cavalo de batalha. Boa qualidade em tudo.",
    lmStudioSearch: "llama-3.1-8b-instruct gguf",
    category: "general",
  },
  {
    id: "qwen-3-7b",
    family: "Qwen",
    name: "Qwen 3 7B",
    params: 7,
    quant: "Q4_K_M",
    fileSizeGB: 4.5,
    minVramGB: 6,
    recommendedVramGB: 8,
    contextWindow: 128_000,
    strengths: ["código", "multilíngue", "raciocínio"],
    thinking: true,
    notes: "Forte em código e multilíngue. ⚠ Tem thinking mode — use max_tokens 4000+.",
    lmStudioSearch: "qwen3-7b gguf",
    category: "general",
  },
  {
    id: "mistral-nemo-12b",
    family: "Mistral",
    name: "Mistral Nemo 12B",
    params: 12,
    quant: "Q4_K_M",
    fileSizeGB: 7.4,
    minVramGB: 7,
    recommendedVramGB: 9,
    contextWindow: 128_000,
    strengths: ["geral", "criativo"],
    notes: "Mistral + NVIDIA. Boa capacidade pra tamanho.",
    lmStudioSearch: "mistral-nemo-12b gguf",
    category: "general",
  },

  // ===== Tier: 12-16 GB VRAM =====
  {
    id: "llama-3.3-8b-q8",
    family: "Llama",
    name: "Llama 3.3 8B (Q8 alta qualidade)",
    params: 8,
    quant: "Q8_0",
    fileSizeGB: 8.5,
    minVramGB: 10,
    recommendedVramGB: 12,
    contextWindow: 128_000,
    strengths: ["geral", "alta fidelidade"],
    notes: "Versão Q8 mais fiel ao modelo original. Recomendado quando VRAM permite.",
    lmStudioSearch: "llama-3.3-8b-instruct q8 gguf",
    category: "general",
  },
  {
    id: "qwen-3-14b",
    family: "Qwen",
    name: "Qwen 3 14B",
    params: 14,
    quant: "Q4_K_M",
    fileSizeGB: 8.2,
    minVramGB: 10,
    recommendedVramGB: 12,
    contextWindow: 128_000,
    strengths: ["código", "raciocínio", "multilíngue"],
    thinking: true,
    notes: "Excelente custo-benefício. Próximo do GPT-4o-mini. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "qwen3-14b gguf",
    category: "general",
  },
  {
    id: "mistral-small-3-24b",
    family: "Mistral",
    name: "Mistral Small 3",
    params: 22,
    quant: "Q4_K_M",
    fileSizeGB: 13,
    minVramGB: 14,
    recommendedVramGB: 16,
    contextWindow: 32_000,
    strengths: ["throughput", "geral"],
    notes: "Otimizado pra alta vazão. Latência baixa.",
    lmStudioSearch: "mistral-small-3 gguf",
    category: "general",
  },
  {
    id: "gemma-2-9b",
    family: "Gemma",
    name: "Gemma 2 9B",
    params: 9,
    quant: "Q4_K_M",
    fileSizeGB: 5.4,
    minVramGB: 7,
    recommendedVramGB: 9,
    contextWindow: 8192,
    strengths: ["geral"],
    notes: "Google. Context window menor.",
    lmStudioSearch: "gemma-2-9b-it gguf",
    category: "general",
  },

  // ===== Tier: 24 GB VRAM =====
  {
    id: "qwen-3-32b",
    family: "Qwen",
    name: "Qwen 3 32B",
    params: 32,
    quant: "Q4_K_M",
    fileSizeGB: 19,
    minVramGB: 22,
    recommendedVramGB: 24,
    contextWindow: 128_000,
    strengths: ["raciocínio profundo", "código avançado"],
    thinking: true,
    notes: "Salto qualitativo claro vs 14B. Próximo de GPT-4o. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "qwen3-32b gguf",
    category: "general",
  },
  {
    id: "mixtral-8x7b",
    family: "Mistral",
    name: "Mixtral 8x7B (MoE)",
    params: 47,
    quant: "Q4_K_M",
    fileSizeGB: 26,
    minVramGB: 24,
    recommendedVramGB: 28,
    contextWindow: 32_000,
    strengths: ["geral", "criativo"],
    notes: "Mixture of Experts. Inferência rápida pra tamanho efetivo.",
    lmStudioSearch: "mixtral-8x7b gguf",
    category: "general",
  },
  {
    id: "gemma-4-26b",
    family: "Gemma",
    name: "Gemma 4 26B (a4b)",
    params: 26,
    quant: "Q4_K_M",
    fileSizeGB: 16,
    minVramGB: 18,
    recommendedVramGB: 22,
    contextWindow: 256_000,
    strengths: ["raciocínio", "multimodal", "256k ctx"],
    thinking: true,
    notes: "Google. Multimodal (texto+imagem). Context 256k. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "gemma-4-26b gguf",
    category: "general",
  },
  {
    id: "gemma-4-e4b",
    family: "Gemma",
    name: "Gemma 4 E4B",
    params: 4,
    quant: "Q4_K_M",
    fileSizeGB: 2.5,
    minVramGB: 4,
    recommendedVramGB: 6,
    contextWindow: 128_000,
    strengths: ["multimodal", "leve"],
    thinking: true,
    notes: "Versão pequena do Gemma 4. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "gemma-4-e4b gguf",
    category: "general",
  },
  {
    id: "gemma-2-27b",
    family: "Gemma",
    name: "Gemma 2 27B",
    params: 27,
    quant: "Q4_K_M",
    fileSizeGB: 16,
    minVramGB: 18,
    recommendedVramGB: 22,
    contextWindow: 8192,
    strengths: ["geral"],
    notes: "Google. Requer mais VRAM que outros 27B.",
    lmStudioSearch: "gemma-2-27b-it gguf",
    category: "general",
  },

  // ===== Tier: 48+ GB VRAM =====
  {
    id: "llama-3.3-70b",
    family: "Llama",
    name: "Llama 3.3 70B",
    params: 70,
    quant: "Q4_K_M",
    fileSizeGB: 42,
    minVramGB: 44,
    recommendedVramGB: 48,
    contextWindow: 128_000,
    strengths: ["raciocínio top", "geral"],
    notes: "Frontier model. Próximo de GPT-4 em muitos benchmarks.",
    lmStudioSearch: "llama-3.3-70b gguf",
    category: "general",
  },
  {
    id: "qwen-3-72b",
    family: "Qwen",
    name: "Qwen 3 72B",
    params: 72,
    quant: "Q4_K_M",
    fileSizeGB: 43,
    minVramGB: 44,
    recommendedVramGB: 48,
    contextWindow: 128_000,
    strengths: ["multilíngue top", "código avançado"],
    thinking: true,
    notes: "Alibaba. Forte em PT/CN/EN. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "qwen3-72b gguf",
    category: "general",
  },
  {
    id: "deepseek-v3",
    family: "DeepSeek",
    name: "DeepSeek V3",
    params: 67,
    quant: "Q4_K_M",
    fileSizeGB: 40,
    minVramGB: 42,
    recommendedVramGB: 48,
    contextWindow: 64_000,
    strengths: ["raciocínio", "código"],
    thinking: true,
    notes: "Forte em raciocínio matemático e programação. ⚠ Thinking model — use max_tokens 4000+.",
    lmStudioSearch: "deepseek-v3 gguf",
    category: "general",
  },

  // ===== CODE-SPECIFIC =====
  {
    id: "qwen-3-coder-7b",
    family: "Qwen Coder",
    name: "Qwen 3 Coder 7B",
    params: 7,
    quant: "Q4_K_M",
    fileSizeGB: 4.5,
    minVramGB: 6,
    recommendedVramGB: 8,
    contextWindow: 128_000,
    strengths: ["código", "fill-in-middle"],
    notes: "Especializado em código. Excelente pra autocomplete.",
    lmStudioSearch: "qwen3-coder-7b gguf",
    category: "code",
  },
  {
    id: "qwen-3-coder-32b",
    family: "Qwen Coder",
    name: "Qwen 3 Coder 32B",
    params: 32,
    quant: "Q4_K_M",
    fileSizeGB: 19,
    minVramGB: 22,
    recommendedVramGB: 24,
    contextWindow: 128_000,
    strengths: ["código avançado", "refactor"],
    notes: "Top open-source pra código em 2026.",
    lmStudioSearch: "qwen3-coder-32b gguf",
    category: "code",
  },
  {
    id: "deepseek-coder-v2",
    family: "DeepSeek Coder",
    name: "DeepSeek Coder V2 16B",
    params: 16,
    quant: "Q4_K_M",
    fileSizeGB: 9.5,
    minVramGB: 11,
    recommendedVramGB: 14,
    contextWindow: 128_000,
    strengths: ["código", "MoE eficiente"],
    notes: "Mistura de especialistas. Rápido e bom.",
    lmStudioSearch: "deepseek-coder-v2 gguf",
    category: "code",
  },
  {
    id: "codestral-22b",
    family: "Codestral",
    name: "Codestral 22B",
    params: 22,
    quant: "Q4_K_M",
    fileSizeGB: 13,
    minVramGB: 14,
    recommendedVramGB: 16,
    contextWindow: 32_000,
    strengths: ["código", "fill-in-middle"],
    notes: "Mistral focado em código. 80+ linguagens.",
    lmStudioSearch: "codestral-22b gguf",
    category: "code",
  },

  // ===== EMBEDDINGS =====
  {
    id: "nomic-embed-text-v1.5",
    family: "Nomic",
    name: "Nomic Embed Text v1.5",
    params: 0.14,
    quant: "F16",
    fileSizeGB: 0.14,
    minVramGB: 1,
    recommendedVramGB: 1,
    contextWindow: 8192,
    strengths: ["embeddings", "RAG", "multilíngue"],
    notes: "Recomendado pra RAG. 768 dims. Roda em qualquer hardware.",
    lmStudioSearch: "nomic-embed-text-v1.5 gguf",
    category: "embedding",
  },
  {
    id: "mxbai-embed-large",
    family: "Mixedbread",
    name: "mxbai-embed-large",
    params: 0.34,
    quant: "F16",
    fileSizeGB: 0.67,
    minVramGB: 1,
    recommendedVramGB: 2,
    contextWindow: 512,
    strengths: ["embeddings", "qualidade top"],
    notes: "1024 dims. Top em MTEB pra tamanho.",
    lmStudioSearch: "mxbai-embed-large gguf",
    category: "embedding",
  },
  {
    id: "bge-large-en-v1.5",
    family: "BAAI",
    name: "BGE Large EN v1.5",
    params: 0.34,
    quant: "F16",
    fileSizeGB: 1.3,
    minVramGB: 1,
    recommendedVramGB: 2,
    contextWindow: 512,
    strengths: ["embeddings", "inglês forte"],
    notes: "1024 dims. Forte em inglês, razoável em código.",
    lmStudioSearch: "bge-large-en-v1.5 gguf",
    category: "embedding",
  },
];

/**
 * Recommend models for given hardware.
 * @param {object} hardware - { estimatedVramGB, isAppleSilicon, ... }
 * @param {object} opts - { category: "general"|"code"|"embedding"|"all", limit }
 * @returns {Array<{model, fitScore}>}
 */
export function recommendFor(hardware, opts = {}) {
  const limit = opts.limit || 6;
  const category = opts.category || "general";
  const vram = hardware.estimatedVramGB ?? 0;

  let pool = CATALOG;
  if (category !== "all") pool = pool.filter((m) => m.category === category);

  const ranked = pool
    .map((m) => ({
      model: m,
      fits: m.recommendedVramGB <= vram + 1,
      barelyFits: m.recommendedVramGB <= vram + 3,
      headroom: vram - m.recommendedVramGB,
    }))
    .filter((x) => x.barelyFits || vram === 0)
    .sort((a, b) => {
      // Prefer models that fit; among fitting, prefer larger params (more capable)
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      return b.model.params - a.model.params;
    })
    .slice(0, limit)
    .map((x) => ({ ...x.model, fitScore: x.fits ? "fit" : "tight" }));

  return ranked;
}

export function findById(id) {
  return CATALOG.find((m) => m.id === id) || null;
}

/* Detect if a free-text model id (e.g. from LM Studio) is likely a thinking
   model. Matches against known thinking families heuristically. */
export function isLikelyThinkingModel(modelIdOrName) {
  if (!modelIdOrName) return false;
  const s = modelIdOrName.toLowerCase();
  // known thinking families
  const patterns = [
    /gemma-?[34]/,        // Gemma 3+ has thinking
    /gemma-?4-/,
    /qwen-?3/,            // Qwen 3 has thinking mode
    /qwq/,                // Qwen QwQ reasoning model
    /deepseek-r1/,
    /deepseek-v3/,
    /phi-?4/,
    /\bo1\b/,             // GPT-o1 family
    /\bo3\b/,
    /thinking/,
    /reasoning/,
  ];
  return patterns.some((re) => re.test(s));
}

export const CATEGORIES = [
  { id: "general", label: "Generalistas" },
  { id: "code", label: "Programação" },
  { id: "embedding", label: "Embeddings (pra RAG)" },
];
