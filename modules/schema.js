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
      "Você é um assistente pessoal pragmático. Responda em português claro, direto e útil. Organize ideias e peça contexto apenas quando for realmente necessário. Se houver ferramentas disponíveis, use-as proativamente quando forem úteis.",
    defaultModel: "",
    sampling: defaultSampling(),
    tools: ["builtin-web_search"],
  },
  {
    id: "developer",
    name: "Developer full-stack",
    icon: "💻",
    systemPrompt:
      "Você é um engenheiro de software sênior especializado em Python, React, TypeScript e PostgreSQL. Responda em português claro e objetivo. Priorize soluções práticas, código correto, modelagem de dados consistente, segurança, testes e tradeoffs técnicos. Ao revisar código, encontre bugs e riscos antes de sugerir melhorias estéticas.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.4, top_p: 0.9 },
    tools: ["builtin-run_javascript"],
  },
  {
    id: "document-analyst",
    name: "Analista de documentos",
    icon: "📄",
    systemPrompt:
      "Você é um analista de documentos. Responda em português claro e use apenas o contexto fornecido quando houver RAG ou workspace. Extraia fatos, valores, datas, responsáveis e divergências. Se a informação não estiver nos trechos, diga isso claramente. Ao comparar múltiplas fontes, organize a resposta por documento.",
    defaultModel: "",
    sampling: { ...defaultSampling(), temperature: 0.3, top_p: 0.9 },
    tools: [],
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
    openPromptPicker: "Ctrl+Shift+P",
    nextProfile: "Ctrl+Shift+M",
    toggleZen: "Ctrl+\\",
    attachFile: "Ctrl+U",
    quickOpen: "Ctrl+P",
    toggleWorkspace: "Ctrl+Shift+E",
  };
}

function connectionDefaults() {
  return {
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
  };
}

function appearanceDefaults() {
  return {
    theme: "system",
    accentColor: "#2563eb",
    fontUI: "system",
    fontMono: "system",
    fontSize: 16,
    density: "normal",
    radius: 10,
    ambientGlow: false,
    glassmorphism: false,
    zenMode: false,
    reducedMotion: "auto",
  };
}

function behaviorDefaults() {
  return {
    submitOn: "enter",
    persistConversations: true,
    confirmOnDelete: true,
    notifications: "disabled",
  };
}

function advancedDefaults() {
  return {
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
    tools: {
      requireConfirmation: false,
    },
    // Configuração da busca web. DDG é default (zero config). Para evitar
    // os bloqueios anti-bot ocasionais do DDG, o usuário pode colar uma
    // chave Brave Search API aqui (free 2000/mês em api.search.brave.com).
    search: {
      braveApiKey: "",
    },
  };
}

function toolsDefaults() {
  return [
    {
      id: "builtin-get_current_datetime",
      name: "get_current_datetime",
      description: "Retorna a data e hora atual com timezone do browser no formato ISO 8601.",
      parameters: { type: "object", properties: {}, required: [] },
      implementation: "builtin:get_current_datetime",
      enabled: false,
      builtIn: true,
    },
    {
      id: "builtin-web_search",
      name: "web_search",
      description: "Busca na web e retorna os primeiros resultados com título, URL e snippet.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca" }
        },
        required: ["query"]
      },
      implementation: "builtin:web_search",
      enabled: false,
      builtIn: true,
    },
    {
      id: "builtin-run_javascript",
      name: "run_javascript",
      description: "Executa código JavaScript e retorna o resultado. Sem acesso a DOM, fetch ou rede.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código JavaScript a executar" }
        },
        required: ["code"]
      },
      implementation: "builtin:run_javascript",
      enabled: false,
      builtIn: true,
    },
  ];
}

function workspaceDefaults() {
  return {
    sources: [],
    activeSourceId: null,
    ignorePatterns: ["node_modules", ".git", "dist", "build", ".next", ".cache", "*.lock", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.exe", "*.dll", "*.so", "*.bin"],
    maxFileBytes: 256 * 1024,
    maxTotalBytes: 4 * 1024 * 1024,
    autoIncludeOpenFiles: false,
    persistContext: false,
    ocrEnabled: false,
  };
}

function ragDefaults() {
  return {
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
    reranking: {
      enabled: false,
      rerankModel: "",
      rerankEndpoint: "",
      candidateK: 20,
      finalK: 5,
      rerankBatchSize: 8,
    },
  };
}

export function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    connection: connectionDefaults(),
    appearance: appearanceDefaults(),
    behavior: behaviorDefaults(),
    activeProfileId: "personal",
    profiles: DEFAULT_PROFILES.map(cloneDefaultProfile),
    keymap: defaultKeymap(),
    advanced: advancedDefaults(),
    tools: toolsDefaults(),
    workspace: workspaceDefaults(),
    rag: ragDefaults(),
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

/* Deep-merge: preenche `target` com chaves ausentes vindas de `source`. Nunca
   sobrescreve valores não-undefined do target. Arrays e Float32Array são
   tratados como atômicos (não há merge item-a-item). Usado pelas soft
   migrations para garantir que campos novos aninhados (ex: rag.reranking.candidateK)
   cheguem em usuários com config antigo sem destruir o que ele já tem. */
export function mergeMissing(target, source) {
  if (source === null || source === undefined) return target;
  if (typeof source !== "object" || Array.isArray(source)) return target;
  if (target === null || target === undefined || typeof target !== "object" || Array.isArray(target)) {
    // Caller deve passar um objeto — clonamos source para não compartilhar ref.
    return JSON.parse(JSON.stringify(source));
  }
  for (const k of Object.keys(source)) {
    if (target[k] === undefined) {
      // Clone profundo para não compartilhar refs com defaults().
      target[k] = source[k] && typeof source[k] === "object"
        ? JSON.parse(JSON.stringify(source[k]))
        : source[k];
    } else if (
      source[k] && typeof source[k] === "object" && !Array.isArray(source[k]) &&
      target[k] && typeof target[k] === "object" && !Array.isArray(target[k])
    ) {
      mergeMissing(target[k], source[k]);
    }
  }
  return target;
}

/* Validação por campo crítico. Em vez de só checar "tem >=1 profile", verifica
   shape mínimo de cada item; itens corrompidos são descartados (com warning).
   Retorna { ok, errors, data } onde data é o objeto saneado.

   Cenário motivador: localStorage pode ter sido editado à mão ou corrompido
   parcialmente — `connection.servers` com null no meio explode o app no boot. */
export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    return { ok: false, errors: ["root not object"], data: defaults() };
  }
  if (obj.schemaVersion !== SCHEMA_VERSION) errors.push("schemaVersion mismatch");

  if (!obj.connection || typeof obj.connection !== "object") {
    errors.push("connection ausente");
  } else if (!Array.isArray(obj.connection.servers)) {
    errors.push("connection.servers nao e array");
  } else {
    const cleanServers = obj.connection.servers.filter(
      (s) => s && typeof s === "object" && typeof s.baseUrl === "string" && typeof s.id === "string"
    );
    if (cleanServers.length !== obj.connection.servers.length) {
      errors.push(`${obj.connection.servers.length - cleanServers.length} server(s) inválido(s) descartado(s)`);
      obj.connection.servers = cleanServers;
    }
    if (!cleanServers.length) errors.push("connection.servers vazio");
  }

  if (!Array.isArray(obj.profiles)) {
    errors.push("profiles nao e array");
  } else {
    const cleanProfiles = obj.profiles.filter(
      (p) => p && typeof p === "object" && typeof p.id === "string" &&
             p.sampling && typeof p.sampling === "object"
    );
    if (cleanProfiles.length !== obj.profiles.length) {
      errors.push(`${obj.profiles.length - cleanProfiles.length} profile(s) inválido(s) descartado(s)`);
      obj.profiles = cleanProfiles;
    }
    if (!cleanProfiles.length) errors.push("profiles vazio");
  }
  return { ok: errors.length === 0, errors, data: obj };
}

/* Migration flags expostas para o caller informar o usuário (ex: toast quando
   v1→v2 acontece, ou re-indexar quando embedder mudou). */
export const migrationFlags = {
  v1Migrated: false,
  embeddingModelBumped: false,
};

export function loadAndMigrate() {
  // 1. Try v2 directly
  let needsPersist = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { ok, errors, data } = validate(parsed);
      if (!ok && errors.length) console.warn("Schema validation:", errors.join("; "));
      const target = data;
      target.schemaVersion = SCHEMA_VERSION;
      ensureDefaultProfiles(target);

      // Soft migrations campo-a-campo (semântica explícita, não automatizada):
      //   max_tokens: thinking models burn 3000-5000 tokens só em CoT.
      //   4096 (default antigo) e null sobem pra 12000. Outros valores fica.
      if (Array.isArray(target.profiles)) {
        for (const p of target.profiles) {
          if (!p.sampling) continue;
          if (p.sampling.max_tokens == null || p.sampling.max_tokens === 4096) {
            p.sampling.max_tokens = 12000;
            needsPersist = true;
          }
        }
      }
      //   embeddingModel: nomic (default antigo) → Qwen3-Embedding-4B (multilingual,
      //   top-1 MTEB). Index antigo fica inválido (dim diferente) → retrieve() rejeita
      //   com erro claro e usuário re-indexa.
      if (target.rag && target.rag.embeddingModel === "nomic-embed-text-v1.5") {
        target.rag.embeddingModel = "text-embedding-qwen3-embedding-4b";
        migrationFlags.embeddingModelBumped = true;
        needsPersist = true;
      }
      //   personal profile: prompt antigo dizia "rodando offline" que biasa o
      //   modelo contra usar tools (web_search). Só substitui se o prompt
      //   ainda for o original (usuário customizado não é tocado).
      const OLD_PERSONAL_PROMPT =
        "Você é um assistente pessoal rodando offline. Responda em português claro, direto e útil. Seja pragmático, organize ideias e peça contexto apenas quando for realmente necessário.";
      if (Array.isArray(target.profiles)) {
        const personal = target.profiles.find((p) => p && p.id === "personal");
        if (personal && personal.systemPrompt === OLD_PERSONAL_PROMPT) {
          personal.systemPrompt =
            "Você é um assistente pessoal pragmático. Responda em português claro, direto e útil. Organize ideias e peça contexto apenas quando for realmente necessário. Se houver ferramentas disponíveis, use-as proativamente quando forem úteis.";
          needsPersist = true;
        }
        // Default tools: se o usuário nunca tocou em tools (array vazio) e o
        // perfil é o personal/developer, ligar web_search por padrão pra que
        // a UX padrão já inclua busca web.
        if (personal && Array.isArray(personal.tools) && personal.tools.length === 0) {
          personal.tools = ["builtin-web_search"];
          needsPersist = true;
        }
      }

      // Soft merge recursivo: garante que QUALQUER campo novo dentro de objetos
      // aninhados (rag.reranking.candidateK, advanced.tools.requireConfirmation,
      // etc) chega em usuários com config antigo sem sobrescrever escolhas.
      const before = JSON.stringify(target);
      mergeMissing(target, defaults());
      if (JSON.stringify(target) !== before) needsPersist = true;

      // tools array: defaults() já cobre via mergeMissing, mas garantir tipos.
      if (!Array.isArray(target.tools)) {
        target.tools = defaults().tools;
        needsPersist = true;
      }
      if (Array.isArray(target.profiles)) {
        for (const p of target.profiles) {
          if (!Array.isArray(p.tools)) { p.tools = []; needsPersist = true; }
        }
      }

      // Persistir após soft migration para não repetir o trabalho no próximo boot.
      if (needsPersist) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(target)); } catch {}
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
      migrationFlags.v1Migrated = true;
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
