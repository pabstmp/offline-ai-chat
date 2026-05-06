/* Schema v2 with defaults, migration v1 → v2, and validation. */

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY_V1 = "offline-ai-chat-settings-v1";
export const STORAGE_KEY = "offline-ai-chat:v2";
export const STORAGE_KEY_V1_BACKUP = "offline-ai-chat:v1.bak";

// Default for users running LM Studio on the same machine.
// For LAN/remote setups, change in Settings → Servidor.
const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export const DEFAULT_PROFILES = [
  {
    id: "personal",
    name: "Assistente pessoal",
    icon: "🧭",
    systemPrompt:
      "Você é um assistente pessoal rodando offline. Responda em português claro, direto e útil. Seja pragmático, organize ideias e peça contexto apenas quando for realmente necessário.",
    defaultModel: "",
    sampling: defaultSampling(),
  },
  {
    id: "developer",
    name: "Developer full-stack",
    icon: "💻",
    systemPrompt:
      "Você é um engenheiro de software sênior especializado em Python, React, TypeScript e PostgreSQL. Responda em português claro e objetivo. Priorize soluções práticas, código correto, modelagem de dados consistente, segurança, testes e tradeoffs técnicos. Ao revisar código, encontre bugs e riscos antes de sugerir melhorias estéticas.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.4, top_p: 0.9 },
  },
  {
    id: "document-analyst",
    name: "Analista de documentos",
    icon: "📄",
    systemPrompt:
      "Você é um analista de documentos. Responda em português claro e use apenas o contexto fornecido quando houver RAG ou workspace. Extraia fatos, valores, datas, responsáveis e divergências. Se a informação não estiver nos trechos, diga isso claramente. Ao comparar múltiplas fontes, organize a resposta por documento.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.3, top_p: 0.9 },
  },
  {
    id: "code-reviewer",
    name: "Code reviewer",
    icon: "🔎",
    systemPrompt:
      "Você é um revisor de código sênior. Priorize bugs, riscos de segurança, regressões, race conditions, performance e testes ausentes. Não gaste espaço com estilo se não afetar comportamento. Quando possível, cite arquivo, função ou trecho específico e proponha correções objetivas.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.25, top_p: 0.9 },
  },
  {
    id: "marketing-manager",
    name: "Gerente de marketing",
    icon: "📣",
    systemPrompt:
      "Você é um gerente de marketing pragmático. Ajude a definir posicionamento, público-alvo, oferta, mensagens-chave, campanhas, canais, calendário editorial, métricas e próximos passos. Priorize clareza comercial, diferenciação, experimentos simples e recomendações acionáveis.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.7, top_p: 0.95 },
  },
  {
    id: "copywriter",
    name: "Redator",
    icon: "✍️",
    systemPrompt:
      "Você é um redator profissional. Escreva textos claros, naturais e persuasivos em português, ajustando tom, estrutura e nível de detalhe ao objetivo. Ao revisar textos, melhore concisão, fluidez, força da mensagem e ambiguidade sem mudar o sentido.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.75, top_p: 0.95 },
  },
  {
    id: "financial-analyst",
    name: "Analista financeiro",
    icon: "💹",
    systemPrompt:
      "Você é um analista financeiro. Analise valores, receitas, custos, margens, variações, projeções e riscos usando apenas os dados fornecidos quando houver documentos ou tabelas no contexto. Declare premissas, destaque inconsistências e não invente números ausentes.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.3, top_p: 0.9 },
  },
];

function cloneDefaultProfile(profile) {
  return { ...profile, sampling: { ...profile.sampling } };
}

function ensureDefaultProfiles(target) {
  if (!Array.isArray(target.profiles)) target.profiles = [];
  const existing = new Set(target.profiles.map((p) => p?.id).filter(Boolean));
  for (const profile of DEFAULT_PROFILES) {
    if (!existing.has(profile.id)) {
      target.profiles.push(cloneDefaultProfile(profile));
      existing.add(profile.id);
    }
  }
  if (!target.activeProfileId && target.profiles[0]) {
    target.activeProfileId = target.profiles[0].id;
  }
}

export function defaultSampling() {
  return {
    temperature: 0.7,
    top_p: null,
    top_k: null,
    min_p: null,
    repeat_penalty: null,
    presence_penalty: null,
    frequency_penalty: null,
    // Default max_tokens=12000 cobre modelos de raciocínio (Gemma 4, DeepSeek R1,
    // Qwen 3, Phi-4) que gastam 3000-5000 tokens só em chain-of-thought. 4096
    // estourava com finish_reason=length e content vazio.
    max_tokens: 12000,
    seed: null,
    stop: [],
    n: null,
    response_format: "text",
  };
}

export function defaultKeymap() {
  return {
    send: "Enter",
    newLine: "Shift+Enter",
    newChat: "Ctrl+N",
    toggleSidebar: "Ctrl+B",
    openSettings: "Ctrl+,",
    openPalette: "Ctrl+K",
    focusComposer: "Ctrl+L",
    stopStream: "Escape",
    nextProfile: "Ctrl+Shift+P",
    toggleZen: "Ctrl+\\",
    attachFile: "Ctrl+U",
    quickOpen: "Ctrl+P",
    toggleWorkspace: "Ctrl+Shift+E",
  };
}

export function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    connection: {
      activeServerId: "default",
      servers: [
        {
          id: "default",
          nickname: "LM Studio local",
          baseUrl: DEFAULT_BASE_URL,
          apiKey: "",
          headers: {},
          timeoutMs: 60000,
          retry: { count: 0, backoffMs: 1000 },
        },
      ],
    },
    appearance: {
      theme: "system",
      accentColor: "#2563eb",
      fontUI: "system",
      fontMono: "system",
      fontSize: 16,
      density: "normal",
      radius: 10,
      ambientGlow: false,
      zenMode: false,
      reducedMotion: "auto",
    },
    behavior: {
      submitOn: "enter",
      persistConversations: true,
      confirmOnDelete: true,
    },
    activeProfileId: "personal",
    profiles: DEFAULT_PROFILES.map(cloneDefaultProfile),
    keymap: defaultKeymap(),
    advanced: {
      streaming: true,
      debugMode: false,
      promptLibrary: [
        { id: "explain", name: "Explicar", body: "Explique passo a passo:", tags: ["geral"] },
        { id: "review", name: "Code review", body: "Revise este código procurando bugs e riscos:", tags: ["dev"] },
      ],
      slashCommands: [
        { trigger: "/code", expansion: "Explique este código:" },
        { trigger: "/fix", expansion: "Identifique problemas e proponha correções neste código:" },
        { trigger: "/test", expansion: "Escreva testes unitários para:" },
      ],
    },
    workspace: {
      sources: [],
      activeSourceId: null,
      ignorePatterns: ["node_modules", ".git", "dist", "build", ".next", ".cache", "*.lock", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.exe", "*.dll", "*.so", "*.bin"],
      maxFileBytes: 256 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
      autoIncludeOpenFiles: false,
      persistContext: false,
      ocrEnabled: false,
    },
    rag: {
      enabled: false,
      // Qwen3-Embedding-4B: state-of-the-art multilingual (top-1 MTEB 2025),
      // trata PT nativamente, 2560 dimensões, 32k context. Best for RAG sobre
      // documentos em português ou bilíngues.
      embeddingModel: "text-embedding-qwen3-embedding-4b",
      // Auto-strategy: detecta automaticamente se a pergunta é comparativa,
      // resumo ou pontual e ajusta topK/maxPerFile. O usuário não precisa pensar.
      autoStrategy: true,
      // Smaller chunks pra granularidade em PDFs com tabelas
      chunkChars: 1500,
      chunkOverlap: 250,
      // topK e maxPerFile só são usados quando autoStrategy=false (modo manual)
      topK: 10,
      maxPerFile: 2,
      batchSize: 32,
      activeForNextMessage: true,
    },
    hardwareOverride: null,
  };
}

/* Migration v1 → v2 */
export function migrateV1ToV2(v1) {
  const base = defaults();
  if (!v1 || typeof v1 !== "object") return base;

  if (typeof v1.serverUrl === "string" && v1.serverUrl.trim()) {
    base.connection.servers[0].baseUrl = v1.serverUrl.trim();
  }
  if (typeof v1.apiKey === "string") base.connection.servers[0].apiKey = v1.apiKey;

  if (Number.isFinite(v1.temperature)) {
    base.profiles.forEach((p) => { p.sampling.temperature = v1.temperature; });
  }
  if (typeof v1.systemPrompt === "string" && v1.systemPrompt.trim()) {
    const profileId = v1.activeProfile === "developer" ? "developer" : "personal";
    const profile = base.profiles.find((p) => p.id === profileId);
    if (profile) profile.systemPrompt = v1.systemPrompt;
    base.activeProfileId = profileId;
  }
  if (typeof v1.model === "string" && v1.model) {
    base.profiles.forEach((p) => { p.defaultModel = v1.model; });
  }
  if (typeof v1.stream === "boolean") base.advanced.streaming = v1.stream;
  if (v1.theme === "light" || v1.theme === "dark" || v1.theme === "system") {
    base.appearance.theme = v1.theme;
  }
  if (v1.density === "compact" || v1.density === "normal" || v1.density === "spacious") {
    base.appearance.density = v1.density;
  }

  return base;
}

/* Validation — returns { ok, errors } and best-effort fix in place */
export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["root not object"], data: defaults() };
  if (obj.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion mismatch");
  if (!obj.connection || !Array.isArray(obj.connection.servers) || !obj.connection.servers.length) {
    errors.push("connection.servers vazio");
  }
  if (!Array.isArray(obj.profiles) || !obj.profiles.length) errors.push("profiles vazio");
  return { ok: errors.length === 0, errors, data: obj };
}

export function loadAndMigrate() {
  // 1. Try v2 directly
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { ok, data } = validate(parsed);
      const target = ok ? data : { ...defaults(), ...parsed, schemaVersion: SCHEMA_VERSION };
      ensureDefaultProfiles(target);
      // Soft migrations of sampling.max_tokens to whatever current default
      // covers thinking models without finish_reason=length.
      // - null  → 12000 (very old config, never had a max_tokens)
      // - 4096  → 12000 (previous default — thinking models routinely burn
      //                  3000-5000 tokens in CoT alone, leaving nothing for
      //                  the actual answer)
      // Users who picked any other value keep it.
      if (Array.isArray(target.profiles)) {
        for (const p of target.profiles) {
          if (!p.sampling) continue;
          if (p.sampling.max_tokens == null || p.sampling.max_tokens === 4096) {
            p.sampling.max_tokens = 12000;
          }
        }
      }
      // Soft migration of embeddingModel: the default used to be the English-
      // leaning nomic-embed-text-v1.5. Qwen3-Embedding-4B is top-1 MTEB and
      // multilingual, so anyone still on the old default gets bumped. The
      // existing index will become invalid (different vector space + different
      // dim count) — retrieve() rejects with a clear "modelo diferente" error
      // and the user just needs to click "Re-indexar".
      if (target.rag && target.rag.embeddingModel === "nomic-embed-text-v1.5") {
        target.rag.embeddingModel = "text-embedding-qwen3-embedding-4b";
      }
      return target;
    }
  } catch (e) {
    console.warn("v2 parse failed, trying migration", e);
  }

  // 2. Try migrate v1
  try {
    const v1raw = localStorage.getItem(STORAGE_KEY_V1);
    if (v1raw) {
      const v1 = JSON.parse(v1raw);
      const v2 = migrateV1ToV2(v1);
      localStorage.setItem(STORAGE_KEY_V1_BACKUP, v1raw);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v2));
      return v2;
    }
  } catch (e) {
    console.warn("v1 migration failed", e);
  }

  // 3. Fresh defaults
  return defaults();
}

export function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("persist failed", e);
  }
}
