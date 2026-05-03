/* Offline AI Chat — entry. Wires modules together. */

import { createStore, debounce } from "./modules/store.js";
import {
  loadAndMigrate, persist, defaults, defaultSampling,
} from "./modules/schema.js";
import { conversationStore } from "./modules/storage.js";
import {
  normalizeBaseUrl, listModels, requestCompletion,
  formatFetchError, buildSamplingPayload,
} from "./modules/api.js";
import { applyAppearance } from "./modules/theme.js";
import {
  registerAction, setKeymap, bindGlobalShortcuts,
} from "./modules/shortcuts.js";
import { renderMarkdown, estimateTokens } from "./modules/markdown.js";
import { initToasts, toast } from "./modules/ui/toasts.js";
import {
  initChat, renderMessage, renderAllMessages,
  setBodyContent, appendStreamingDelta, finalizeAssistant,
  scrollToBottom,
} from "./modules/ui/chat.js";
import {
  initComposer, clearComposer, focusComposer, setBusy as setComposerBusy,
  setComposerValue, setHistoryTokens,
} from "./modules/ui/composer.js";
import {
  initSidebar, refreshSidebar, setActiveConversation, toggleSidebar, closeSidebar,
} from "./modules/ui/sidebar.js";
import { initPalette, openPalette } from "./modules/ui/palette.js";
import { initSettings, openSettings, closeSettings, setModelOptions } from "./modules/ui/settings.js";
import { initWorkspace, preprocessSlashCommands } from "./modules/ui/workspace.js";
import {
  injectContextIntoMessage, isPersistAcrossMessages, clearFiles, listFiles,
} from "./modules/workspace/context.js";
import * as rag from "./modules/rag/manager.js";

/* ---------- elements ---------- */

const $ = (s) => document.querySelector(s);
const elements = {
  // app
  app: $(".app"),
  // topbar
  sidebarToggle: $("#sidebarToggle"),
  profileChip: $("#profileChip"),
  profileChipLabel: $("#profileChipLabel"),
  modelChip: $("#modelChip"),
  modelChipLabel: $("#modelChipLabel"),
  statusPill: $("#statusPill"),
  statusDot: $("#statusDot"),
  statusLabel: $("#statusLabel"),
  workspaceToggle: $("#workspaceToggle"),
  paletteButton: $("#paletteButton"),
  settingsButton: $("#settingsButton"),
  // sidebar
  sidebar: $("#sidebar"),
  sidebarBackdrop: $("#sidebarBackdrop"),
  newChatButton: $("#newChatButton"),
  historySearch: $("#historySearch"),
  historyList: $("#historyList"),
  // chat
  messages: $("#messages"),
  messagesInner: $("#messagesInner"),
  emptyState: $("#emptyState"),
  scrollDownButton: $("#scrollDownButton"),
  // composer
  chatForm: $("#chatForm"),
  promptInput: $("#promptInput"),
  tokenCount: $("#tokenCount"),
  attachButton: $("#attachButton"),
  ragPill: $("#ragPill"),
  sendButton: $("#sendButton"),
  stopButton: $("#stopButton"),
  contextPanel: $("#contextPanel"),
  // settings drawer
  settingsDrawer: $("#settingsDrawer"),
  drawerBackdrop: $("#drawerBackdrop"),
  settingsClose: $("#settingsClose"),
  settingsTabs: $("#settingsTabs"),
  settingsBody: $("#settingsBody"),
  // toasts
  toasts: $("#toasts"),
};

/* ---------- store ---------- */

const initial = loadAndMigrate();
const store = createStore(initial);
const debouncedPersist = debounce(() => persist(store.raw()), 250);
// Force initial persist so localStorage reflects current state (handles fresh
// boot + soft migrations like max_tokens default upgrade).
persist(initial);

/* ---------- runtime state ---------- */

const runtime = {
  abortController: null,
  busy: false,
  currentConversation: null, // { id, title, messages, ... }
  models: [],
};

/* ---------- helpers ---------- */

function getActiveServer() {
  const conn = store.get("connection");
  return conn.servers.find((s) => s.id === conn.activeServerId) || conn.servers[0];
}

function getActiveProfile() {
  const profiles = store.get("profiles") || [];
  const id = store.get("activeProfileId");
  return profiles.find((p) => p.id === id) || profiles[0];
}

function refreshChips() {
  const server = getActiveServer();
  const profile = getActiveProfile();
  elements.modelChipLabel.textContent = profile?.defaultModel || "Sem modelo";
  elements.profileChipLabel.textContent = profile ? `${profile.icon || ""} ${profile.name}`.trim() : "Perfil";
}

function setStatus(kind, label) {
  elements.statusDot.className = `dot ${kind || ""}`.trim();
  elements.statusLabel.textContent = label;
}

function toggleEmptyState() {
  const has = elements.messagesInner.querySelector(".msg") !== null;
  elements.emptyState.classList.toggle("hidden", has);
}

/* ---------- conversations ---------- */

function newConversation() {
  runtime.currentConversation = {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "(nova conversa)",
    profileId: store.get("activeProfileId"),
    serverId: store.get("connection.activeServerId"),
    model: getActiveProfile()?.defaultModel,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  renderAllMessages([]);
  toggleEmptyState();
  setActiveConversation(runtime.currentConversation.id);
  setHistoryTokens(0);
}

async function loadConversation(id) {
  const conv = await conversationStore.get(id);
  if (!conv) return;
  runtime.currentConversation = conv;
  renderAllMessages(conv.messages || []);
  toggleEmptyState();
  setActiveConversation(id);
  closeSidebar();
  recomputeHistoryTokens();
}

async function saveCurrentConversation() {
  if (!runtime.currentConversation) return;
  if (!store.get("behavior.persistConversations")) return;
  const c = runtime.currentConversation;
  if (!c.messages.length) return;
  if (c.title === "(nova conversa)") {
    const firstUser = c.messages.find((m) => m.role === "user");
    if (firstUser) c.title = firstUser.content.slice(0, 40).trim() || "(sem título)";
  }
  c.updatedAt = Date.now();
  await conversationStore.upsert(c);
  refreshSidebar();
}

function recomputeHistoryTokens() {
  if (!runtime.currentConversation) { setHistoryTokens(0); return; }
  let total = 0;
  for (const m of runtime.currentConversation.messages) total += estimateTokens(m.content);
  setHistoryTokens(total);
}

/* ---------- API: load models ---------- */

async function loadModels(serverArg) {
  const server = serverArg || getActiveServer();
  if (!server?.baseUrl) return [];
  let baseUrl;
  try { baseUrl = normalizeBaseUrl(server.baseUrl); }
  catch { setStatus("error", "URL inválida"); return []; }

  setStatus("connecting", "Conectando");
  try {
    const models = await listModels({ baseUrl, apiKey: server.apiKey, timeoutMs: server.timeoutMs });
    runtime.models = models;
    setModelOptions(models);
    setStatus(models.length ? "connected" : "error", models.length ? "Conectado" : "Sem modelos");
    if (!serverArg) toast(`${models.length} modelo(s) disponível(is)`, "success");
    refreshChips();
    return models;
  } catch (error) {
    const detail = formatFetchError(error);
    setStatus("error", "Falha");
    if (!serverArg) toast(detail, "error", 5000);
    throw error;
  }
}

/* ---------- API: chat completion ---------- */

/* Strategies for each detected intent. Centralizing here so the regex pre-pass
   and the LLM classifier produce identical strategy objects. */
function makeStrategy(mode, fileCount, source) {
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

/* Fast regex pre-pass. Catches obvious cases at zero cost (no LLM call).
   Returns "comparative" / "summary" / null (= unsure, ask the LLM). */
function intentFromRegex(query) {
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

/* Ask the loaded chat model to classify the query. Used when regex didn't match.
   Returns "comparative" | "summary" | "point" | null (on failure). */
async function intentFromLLM(query, fileCount, server, profile) {
  const startedAt = Date.now();
  try {
    const { requestCompletion } = await import("./modules/api.js");
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
      if (store.get("advanced.debugMode")) {
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

/* Detect query intent. Asks the loaded LLM to classify — handles any
   phrasing, any language, no regex maintenance. Falls back to a regex
   pre-pass only if the LLM is unreachable / model not loaded / timed out.
   Final fallback: "comparative" (cobertura completa é mais seguro que
   perder documentos). No caching: each query is classified fresh. */
async function detectQueryStrategy(query, fileCount, server, profile) {
  const fromLLM = await intentFromLLM(query, fileCount, server, profile);
  if (fromLLM) return makeStrategy(fromLLM, fileCount, "llm");

  // LLM offline / não respondeu — tenta regex como heurística rápida
  const fromRegex = intentFromRegex(query);
  if (fromRegex) return makeStrategy(fromRegex, fileCount, "regex-fallback");

  // Tudo falhou: assume comparative (envia mais chunks, não perde info)
  return makeStrategy("comparative", fileCount, "fallback-safe");
}

/* RAG: try to retrieve top-K chunks for this query and build the injected block.
   Returns { applied: bool, injected?: string, error?: string }. */
async function tryRagRetrieve(rawText, server, baseUrl, profile) {
  const ragCfg = store.get("rag");
  if (!ragCfg.enabled || !ragCfg.activeForNextMessage) return { applied: false };

  const ws = store.get("workspace");
  const sourceId = ws.activeSourceId;
  if (!sourceId) return { applied: false };

  // Check if source is actually indexed
  const meta = await rag.getStatus(sourceId);
  if (!meta || meta.chunkCount === 0) return { applied: false };

  if (!ragCfg.embeddingModel) {
    toast("RAG: defina um modelo de embedding em Configurações.", "warn");
    return { applied: false };
  }

  // Auto-strategy unless user explicitly disabled
  const autoMode = ragCfg.autoStrategy !== false;
  let strategy;
  if (autoMode) {
    strategy = await detectQueryStrategy(rawText, meta.fileCount || 1, server, profile);
    if (store.get("advanced.debugMode")) {
      console.log(`[RAG] strategy: ${strategy.mode} · topK=${strategy.topK} · maxPerFile=${strategy.maxPerFile} (${strategy.hint})`);
    }
  } else {
    strategy = {
      mode: "manual",
      topK: ragCfg.topK || 10,
      maxPerFile: ragCfg.maxPerFile || 0,
      hint: "configuração manual",
    };
  }

  try {
    const results = await rag.retrieve({
      sourceId,
      query: rawText,
      embedConfig: {
        baseUrl,
        apiKey: server.apiKey,
        model: ragCfg.embeddingModel,
      },
      k: strategy.topK,
      maxPerFile: strategy.maxPerFile,
      includeFirstPerFile: !!strategy.includeFirstPerFile,
      coverAllFiles: !!strategy.coverAllFiles,
      exhaustive: !!strategy.exhaustive,
    });
    if (!results.length) return { applied: false };
    const filesInResult = new Set(results.map((r) => r.path)).size;
    const wasExhaustive = results.length > 0 && results[0]._reason === "exhaustive";
    if (store.get("advanced.debugMode")) {
      console.log(`[RAG] mode=${strategy.mode} ${wasExhaustive ? "EXHAUSTIVE " : ""}retrieved ${results.length} chunks covering ${filesInResult}/${meta.fileCount} files`);
    }
    // Surface coverage to the user when it matters (comparative + missing files).
    if (strategy.mode === "comparative" && filesInResult < (meta.fileCount || 0)) {
      toast(
        `RAG: ${filesInResult} de ${meta.fileCount} arquivos couberam no contexto. Pra cobertura total, aumente Context Length no LM Studio ou re-indexe com chunks menores.`,
        "warn",
        7000,
      );
    }
    const block = buildRagBlock(results, rawText, { ...strategy, wasExhaustive });
    return { applied: true, injected: block };
  } catch (err) {
    toast(`RAG falhou: ${err.message}. Enviando sem contexto.`, "warn", 5000);
    return { applied: false, error: err.message };
  }
}

function buildRagBlock(results, query, strategy) {
  // Compute coverage so the model knows whether it's seeing the full index
  // or only a similarity-filtered subset.
  const filesInResult = [...new Set(results.map((r) => r.path))];
  let coverageNote;
  if (strategy?.wasExhaustive) {
    coverageNote = `Cobertura: ÍNDICE COMPLETO. Todos os ${results.length} chunks de todos os ${filesInResult.length} arquivos foram incluídos abaixo, ordenados por arquivo. Você está vendo a base inteira — qualquer afirmação sobre "documentos não disponíveis" é incorreta.`;
  } else if (strategy?.coverAllFiles) {
    coverageNote = `Cobertura: TODOS os ${filesInResult.length} arquivos do índice estão representados abaixo (1+ chunk de cada). NÃO mencione "documentos não recuperados".`;
  } else {
    coverageNote = `Cobertura parcial: ${filesInResult.length} arquivo(s) representado(s). Outros podem existir no índice mas não casaram com a busca semântica desta pergunta.`;
  }

  const parts = [];
  parts.push("# Instruções pro Assistente");
  parts.push("");
  parts.push("Você está respondendo uma pergunta usando trechos recuperados de documentos do projeto via RAG. Siga estas regras:");
  parts.push("");
  parts.push("1. Use APENAS as informações dos trechos abaixo no bloco <workspace_context>. NÃO invente, infira além do explícito ou use conhecimento externo.");
  parts.push("2. Se a pergunta requer informação que não está nos trechos, diga claramente: \"Não encontrei essa informação nos trechos recuperados.\"");
  parts.push("3. **Citações: NÃO cite a fonte em cada linha.** A resposta principal deve ser lida sem ruído. Quando o leitor precisar saber de onde veio cada fato, agrupe a informação por documento (ex: cabeçalho `### nome-do-arquivo.pdf`). Se a resposta for um número/conclusão única, adicione no fim uma linha `_Fontes: arquivo1.pdf, arquivo2.pdf_`.");
  parts.push("4. Se múltiplos trechos do mesmo arquivo aparecerem, agregue antes de responder.");
  parts.push(`5. ${coverageNote}`);
  parts.push("6. Para tabelas em PDFs: o texto extraído pode estar desestruturado. Tente identificar pares chave-valor mas se ficar ambíguo, diga.");
  parts.push("7. Use markdown limpo: títulos `###`, listas com `-`, negrito só pra valores importantes. Evite repetir labels redundantes.");
  parts.push("");
  parts.push("<workspace_context kind=\"rag\">");
  parts.push(`Trechos recuperados (${results.length} chunks de ${filesInResult.length} arquivos):`);
  parts.push("");
  results.forEach((r, idx) => {
    parts.push(`## Trecho ${idx + 1} — ${r.path} · linhas ${r.lineStart}-${r.lineEnd} · score ${r.score.toFixed(3)}`);
    parts.push("```");
    parts.push(r.text);
    parts.push("```");
    parts.push("");
  });
  parts.push("</workspace_context>");
  parts.push("");
  parts.push(`# Pergunta do usuário`);
  parts.push("");
  parts.push(query);
  return parts.join("\n");
}

async function refreshRagPill() {
  const pill = elements.ragPill;
  if (!pill) return;
  const ragCfg = store.get("rag");
  const ws = store.get("workspace");

  // Pill sempre visível quando RAG enabled — comunica claramente o estado
  if (!ragCfg.enabled) {
    pill.classList.add("hidden");
    return;
  }
  pill.classList.remove("hidden");

  const labelEl = pill.querySelector("span:last-child") || pill.querySelector("span:not(.rag-pill-dot)");
  const setState = (state, label, title) => {
    pill.dataset.state = state;
    pill.classList.toggle("disabled", state !== "ready" || !ragCfg.activeForNextMessage);
    if (labelEl) labelEl.textContent = label;
    pill.title = title;
  };

  const sourceId = ws.activeSourceId;
  if (!sourceId) {
    setState("no-source", "RAG · sem fonte",
      "RAG ligado mas nenhuma fonte de Workspace ativa. Adicione uma em Configurações → Workspace.");
    return;
  }

  const meta = await rag.getStatus(sourceId);
  if (!meta || meta.chunkCount === 0) {
    setState("not-indexed", "RAG · não indexado",
      "Fonte ativa não foi indexada ainda. Vá em Configurações → Workspace e clique em 'Indexar com RAG'.");
    return;
  }

  // Check model mismatch
  if (meta.embeddingModel !== ragCfg.embeddingModel) {
    setState("mismatch", "RAG · ⚠ modelo diferente",
      `Indexado com "${meta.embeddingModel}" mas config atual usa "${ragCfg.embeddingModel}". Re-indexe (Configurações → Workspace) ou alinhe a config.`);
    return;
  }

  // All good
  setState("ready", `RAG · ${meta.chunkCount} chunks`,
    ragCfg.activeForNextMessage
      ? `RAG ativo · ${meta.chunkCount} chunks de ${meta.fileCount} arquivos · clique pra desativar nesta mensagem`
      : `RAG desativado pra esta mensagem · clique pra reativar`);
}

async function submitMessage(rawText) {
  if (runtime.busy) return;

  // workspace slash commands (/include, /clear-context)
  const slashResult = await preprocessSlashCommands(rawText);
  if (slashResult?.handled) {
    toast(slashResult.message, slashResult.isError ? "error" : "info");
    clearComposer();
    return;
  }

  const server = getActiveServer();
  if (!server?.baseUrl) {
    openSettings("server");
    toast("Configure um servidor primeiro.", "warn");
    return;
  }
  let baseUrl;
  try { baseUrl = normalizeBaseUrl(server.baseUrl); }
  catch { toast("URL inválida.", "error"); return; }

  const profile = getActiveProfile();
  let model = profile.defaultModel;
  if (!model && runtime.models.length) model = runtime.models[0];
  if (!model) {
    try {
      await loadModels();
      model = profile.defaultModel || runtime.models[0];
    } catch {}
  }
  if (!model) { toast("Modelo ausente.", "error"); openSettings("profiles"); return; }

  if (!runtime.currentConversation) newConversation();

  // Build the content to send. Priority:
  //  1) RAG (if enabled, source indexed, model matches, pill on)
  //  2) Workspace stuffing (legacy — files manually attached)
  //  3) raw text
  let userContent = rawText;
  const ragInfo = await tryRagRetrieve(rawText, server, baseUrl, profile);
  if (ragInfo.applied) {
    userContent = ragInfo.injected;
  } else if (listFiles().length) {
    userContent = injectContextIntoMessage(rawText);
    if (!isPersistAcrossMessages()) {
      setTimeout(() => clearFiles(), 0);
    }
  }

  setComposerBusy(true);
  runtime.busy = true;
  runtime.abortController = new AbortController();

  // user message
  const userMsg = { role: "user", content: rawText, ts: Date.now(), id: `m-${Date.now()}-u` };
  runtime.currentConversation.messages.push(userMsg);
  renderMessage(userMsg);
  toggleEmptyState();
  clearComposer();

  // assistant placeholder — IMPORTANT: also push to conversation so it persists
  const assistantMsg = { role: "assistant", content: "", ts: Date.now(), id: `m-${Date.now()}-a` };
  runtime.currentConversation.messages.push(assistantMsg);
  const { body: assistantBody } = renderMessage(assistantMsg, { streaming: true });

  // build payload
  const useStreaming = store.get("advanced.streaming");
  const sampling = buildSamplingPayload(profile.sampling);
  const messages = [];
  if (profile.systemPrompt) messages.push({ role: "system", content: profile.systemPrompt });
  for (const m of runtime.currentConversation.messages.slice(0, -1)) {
    messages.push({ role: m.role, content: m.content });
  }
  // replace last user with potentially-injected version
  messages.push({ role: "user", content: userContent });

  const payload = { messages, model, stream: useStreaming, ...sampling };
  if (store.get("advanced.debugMode")) {
    console.group("offline-ai request");
    console.log({ baseUrl, payload });
    console.groupEnd();
  }

  setStatus("connecting", "Gerando");

  let assistantContent = "";
  let assistantReasoning = "";
  let usage = null;
  let finishReason = null;
  try {
    const result = await requestCompletion(
      { baseUrl, apiKey: server.apiKey, payload, signal: runtime.abortController.signal },
      (_delta, full) => {
        assistantContent = full.content;
        assistantReasoning = full.reasoning;
        appendStreamingDelta(assistantBody, full.content, full.reasoning);
      }
    );
    assistantContent = result.content;
    assistantReasoning = result.reasoning;
    usage = result.usage;
    finishReason = result.finishReason;

    if (!assistantContent.trim() && assistantReasoning.trim()) {
      // Reasoning consumed all available output tokens. Two possible causes:
      // 1) max_tokens setting too low
      // 2) LM Studio's n_ctx (context length) too small for prompt + completion
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || Math.ceil(assistantReasoning.length / 4);
      const promptTokens = usage?.prompt_tokens || 0;
      const currentMax = profile.sampling?.max_tokens || "default-do-servidor";
      const completionAllocated = usage?.completion_tokens || reasoningTokens;

      // If max_tokens is high (e.g. 4096) but completion finished tiny, the
      // bottleneck is almost certainly LM Studio's n_ctx (model context length)
      const likelyCtxIssue = typeof currentMax === "number" && currentMax >= 2048 && completionAllocated < currentMax / 4;

      let diag = `(modelo gastou ${reasoningTokens} tokens em raciocínio + 0 em resposta · prompt: ${promptTokens} · max_tokens config: ${currentMax} · completion alocado: ${completionAllocated} · finish: ${finishReason || "?"})\n\n`;

      if (likelyCtxIssue && finishReason === "length") {
        diag +=
          `⚠ Provável **Context Length insuficiente no LM Studio**.\n\n` +
          `Você configurou max_tokens=${currentMax}, mas o servidor só conseguiu alocar ${completionAllocated} tokens. Isso significa que prompt (${promptTokens}) + completion bateu no n_ctx do modelo carregado.\n\n` +
          `Solução principal:\n` +
          `• Abra o LM Studio → modelo carregado → "Context Length" → mude de 4096 para 16384 ou 32768 → recarregue\n\n` +
          `Alternativas:\n` +
          `• Reduza Top-K em Configurações → RAG (de 5 pra 3)\n` +
          `• Reduza chunk size de 2400 pra 1200 e re-indexe\n` +
          `• Use modelo não-thinking (llama-3.2-3b, mistral-nemo-12b)`;
      } else {
        // Auto-fix: bump max_tokens for the active profile so the next attempt
        // has room. Modelos thinking gastam 3-5k em CoT — dobrar (mínimo 12k)
        // resolve a maioria dos casos sem mais um pedido manual ao usuário.
        const newMax = Math.max(typeof currentMax === "number" ? currentMax * 2 : 0, 12000);
        if (typeof currentMax !== "number" || newMax > currentMax) {
          profile.sampling.max_tokens = newMax;
          store.set("profiles", store.get("profiles"));
          diag +=
            `✓ **Auto-fix aplicado**: max_tokens subiu de ${currentMax} → ${newMax}.\n\n` +
            `Repete a pergunta — agora o modelo tem espaço pra raciocinar e responder.\n\n` +
            `(Se ainda falhar, o gargalo é Context Length do LM Studio: abra o modelo carregado lá → mude de 4096 pra 16384+ → recarregue.)`;
        } else {
          diag +=
            `⚠ Modelos de raciocínio (Gemma 4, DeepSeek R1, Qwen 3, Phi-4) gastam tokens em chain-of-thought que contam dentro do max_tokens.\n\n` +
            `Soluções:\n` +
            `• Configurações → Perfis & Inferência → marca o checkbox de max_tokens → coloca 16000+\n` +
            `• Ou desabilite thinking no LM Studio (se o modelo permite)\n` +
            `• Ou troque pra um modelo não-thinking (llama-3.1-8b, mistral-nemo-12b)`;
        }
      }
      assistantContent = diag;
    } else if (!assistantContent.trim()) {
      const promptTokens = usage?.prompt_tokens || messages.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);
      let hint = `(servidor respondeu sem conteúdo · prompt: ${promptTokens} tok · finish: ${finishReason || "?"})`;
      if (promptTokens > 3500) {
        hint += `\n\n⚠ Prompt grande (~${promptTokens} tokens). Pode ter estourado context length do modelo carregado no LM Studio. Use RAG ou aumente Context Length no LM Studio.`;
      } else {
        hint += "\n\nVerifique se o modelo está carregado no LM Studio e se o servidor não está em outra porta.";
      }
      assistantContent = hint;
    } else if (finishReason === "length") {
      // Truncated mid-content
      assistantContent += `\n\n⚠ (truncado — bateu max_tokens. Aumente em Configurações → Modelo)`;
    }

    finalizeAssistant(assistantBody, assistantContent, false, assistantReasoning, { usage, finishReason });
    assistantMsg.content = assistantContent;
    if (assistantReasoning) assistantMsg.reasoning = assistantReasoning;
    setStatus("connected", "Pronto");
  } catch (error) {
    if (error?.name === "AbortError") {
      const interrupted = assistantContent ? `${assistantContent}\n\n[Interrompido]` : "Interrompido.";
      finalizeAssistant(assistantBody, interrupted, false, assistantReasoning);
      assistantMsg.content = interrupted;
      if (assistantReasoning) assistantMsg.reasoning = assistantReasoning;
      setStatus("connected", "Interrompido");
    } else {
      const detail = formatFetchError(error);
      finalizeAssistant(assistantBody, detail, true);
      assistantMsg.content = detail;
      setStatus("error", "Erro");
      toast(detail, "error", 5000);
    }
  } finally {
    runtime.abortController = null;
    runtime.busy = false;
    setComposerBusy(false);
    saveCurrentConversation();
    recomputeHistoryTokens();
  }
}

/* ---------- conversation list actions ---------- */

async function handleSidebarAction({ action, conversation }) {
  if (action === "rename") {
    const next = prompt("Novo título:", conversation.title);
    if (next && next.trim()) {
      conversation.title = next.trim();
      conversation.updatedAt = Date.now();
      await conversationStore.upsert(conversation);
      refreshSidebar();
    }
  } else if (action === "delete") {
    if (store.get("behavior.confirmOnDelete") && !confirm(`Excluir "${conversation.title}"?`)) return;
    await conversationStore.remove(conversation.id);
    if (runtime.currentConversation?.id === conversation.id) {
      runtime.currentConversation = null;
      renderAllMessages([]);
      toggleEmptyState();
    }
    refreshSidebar();
    toast("Conversa excluída.", "info");
  } else if (action === "export-json") {
    downloadFile(`${conversation.title || conversation.id}.json`,
      JSON.stringify(conversation, null, 2), "application/json");
  } else if (action === "export-md") {
    const md = conversationToMarkdown(conversation);
    downloadFile(`${conversation.title || conversation.id}.md`, md, "text/markdown");
  }
}

function conversationToMarkdown(conv) {
  const lines = [`# ${conv.title || conv.id}`, ""];
  for (const m of conv.messages || []) {
    lines.push(`**${m.role === "user" ? "Você" : "Assistente"}**:`);
    lines.push("");
    lines.push(m.content);
    lines.push("");
  }
  return lines.join("\n");
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/* ---------- message actions ---------- */

async function handleMessageAction({ action, message, node, body }) {
  if (action === "copy") {
    await navigator.clipboard?.writeText(message.content || "");
    toast("Copiado", "success", 1500);
  } else if (action === "delete") {
    const conv = runtime.currentConversation;
    if (!conv) return;
    if (store.get("behavior.confirmOnDelete") && !confirm("Excluir esta mensagem?")) return;
    conv.messages = conv.messages.filter((m) => m.id !== message.id);
    node.remove();
    saveCurrentConversation();
    recomputeHistoryTokens();
    toggleEmptyState();
  } else if (action === "edit") {
    const next = prompt("Editar mensagem:", message.content);
    if (next != null && next !== message.content) {
      message.content = next;
      setBodyContent(body, next, false);
      saveCurrentConversation();
      recomputeHistoryTokens();
    }
  } else if (action === "regen") {
    if (runtime.busy) return;
    const conv = runtime.currentConversation;
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    const previousUser = [...conv.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!previousUser) return;
    // remove this assistant + redo
    conv.messages.splice(idx, 1);
    node.remove();
    submitMessage(previousUser.content);
  }
}

/* ---------- shortcuts ---------- */

function buildPaletteCommands() {
  const profiles = store.get("profiles") || [];
  const conn = store.get("connection");
  return [
    { label: "Nova conversa", icon: "✨", run: newConversation },
    { label: "Limpar contexto do workspace", icon: "🧹", run: () => clearFiles() },
    { label: "Configurações: Servidor", icon: "🖧", run: () => openSettings("server") },
    { label: "Configurações: Perfis & Inferência", icon: "🧠", run: () => openSettings("profiles") },
    { label: "Configurações: Hardware", icon: "🖥️", run: () => openSettings("model") },
    { label: "Configurações: Aparência", icon: "🎨", run: () => openSettings("appearance") },
    { label: "Configurações: Perfis", icon: "👤", run: () => openSettings("profiles") },
    { label: "Configurações: Atalhos", icon: "⌨", run: () => openSettings("shortcuts") },
    { label: "Configurações: Workspace", icon: "📁", run: () => openSettings("workspace") },
    { label: "Configurações: Avançado", icon: "🛠", run: () => openSettings("advanced") },
    { label: "Toggle tema (claro/escuro)", icon: "☀", run: toggleTheme },
    { label: "Toggle modo zen", icon: "🧘", run: toggleZen },
    ...profiles.map((p) => ({
      label: `Perfil: ${p.name}`, hint: p.systemPrompt.slice(0, 40), icon: p.icon || "👤",
      run: () => { store.set("activeProfileId", p.id); refreshChips(); toast(`Perfil: ${p.name}`, "info"); },
    })),
    ...conn.servers.map((s) => ({
      label: `Servidor: ${s.nickname}`, icon: "🖧", hint: s.baseUrl,
      run: () => { store.set("connection.activeServerId", s.id); loadModels().catch(() => {}); },
    })),
    ...runtime.models.map((m) => ({
      label: `Modelo: ${m}`, icon: "🧠",
      run: () => {
        const profile = getActiveProfile();
        profile.defaultModel = m;
        refreshChips();
        toast(`Modelo: ${m}`, "info");
      },
    })),
  ];
}

function toggleTheme() {
  const a = store.get("appearance");
  const next = a.theme === "dark" ? "light" : "dark";
  a.theme = next;
  applyAppearance(a);
}

function toggleZen() {
  const a = store.get("appearance");
  a.zenMode = !a.zenMode;
  applyAppearance(a);
}

function nextProfile() {
  const profiles = store.get("profiles") || [];
  if (!profiles.length) return;
  const id = store.get("activeProfileId");
  const idx = profiles.findIndex((p) => p.id === id);
  const next = profiles[(idx + 1) % profiles.length];
  store.set("activeProfileId", next.id);
  refreshChips();
  toast(`Perfil: ${next.name}`, "info");
}

/* ---------- init ---------- */

async function init() {
  // apply appearance immediately
  applyAppearance(store.get("appearance"));

  // toasts
  initToasts(elements.toasts);

  // store changes → debounced persist
  store.subscribe(() => debouncedPersist());

  // init UI subsystems
  initChat({ elements, state: runtime, store, onAction: handleMessageAction });
  initComposer({
    elements, store,
    onSubmit: submitMessage,
  });
  initSidebar({
    elements, store, conversationStore,
    onSelect: loadConversation,
    onNew: newConversation,
    onAction: handleSidebarAction,
  });
  initPalette();
  initSettings({
    elements, store,
    onChange: () => { debouncedPersist(); refreshChips(); },
    onConnect: () => loadModels().catch(() => {}),
    onLoadModels: (server) => loadModels(server),
    onProfileChange: () => { refreshChips(); applyAppearance(store.get("appearance")); },
  });
  initWorkspace({ elements, store });

  // suggestions
  document.querySelectorAll(".suggestion-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setComposerValue(chip.dataset.prompt || "");
      focusComposer();
    });
  });

  // topbar
  elements.sidebarToggle.addEventListener("click", toggleSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);
  elements.profileChip.addEventListener("click", () => openSettings("profiles"));
  elements.modelChip.addEventListener("click", () => openSettings("profiles"));
  elements.statusPill.addEventListener("click", () => openSettings("server"));
  elements.settingsButton.addEventListener("click", () => openSettings());
  elements.paletteButton.addEventListener("click", () => openPalette(buildPaletteCommands()));

  // stop button
  elements.stopButton.addEventListener("click", () => runtime.abortController?.abort());

  // RAG pill click — different behavior per state
  if (elements.ragPill) {
    elements.ragPill.addEventListener("click", () => {
      const state = elements.ragPill.dataset.state;
      if (state === "ready") {
        // Toggle on/off for next message
        const cfg = store.get("rag");
        cfg.activeForNextMessage = !cfg.activeForNextMessage;
        refreshRagPill();
      } else if (state === "no-source" || state === "not-indexed" || state === "mismatch") {
        // Open settings to fix
        openSettings("workspace");
      }
    });
  }
  // Refresh pill when settings change or rag manager fires events
  store.on("rag", () => refreshRagPill());
  store.on("workspace.activeSourceId", () => refreshRagPill());
  rag.subscribe((evt) => {
    refreshRagPill();
    if (evt.kind === "done") {
      const ocrFiles = evt.result?.ocrNeededFiles || [];
      const ocred = evt.result?.ocredFiles || [];
      if (ocrFiles.length) {
        const sample = ocrFiles.slice(0, 3).join(", ");
        const more = ocrFiles.length > 3 ? ` (+${ocrFiles.length - 3})` : "";
        toast(
          `${ocrFiles.length} PDF${ocrFiles.length > 1 ? "s parecem escaneados" : " parece escaneado"} e foi pulado: ${sample}${more}. Ative "OCR para PDFs escaneados" em Configurações → Workspace.`,
          "warn",
          10000,
        );
      }
      if (ocred.length) {
        const totalPages = ocred.reduce((s, f) => s + (f.pagesOcred || 0), 0);
        toast(
          `OCR aplicado em ${ocred.length} PDF${ocred.length > 1 ? "s" : ""} (${totalPages} página${totalPages > 1 ? "s" : ""}).`,
          "success",
          5000,
        );
      }
    }
  });

  // shortcuts
  registerAction("send", () => elements.chatForm.requestSubmit());
  registerAction("newChat", newConversation);
  registerAction("toggleSidebar", toggleSidebar);
  registerAction("openSettings", () => openSettings());
  registerAction("openPalette", () => openPalette(buildPaletteCommands()));
  registerAction("focusComposer", focusComposer);
  registerAction("stopStream", () => {
    if (runtime.busy) runtime.abortController?.abort();
    else closeSettings();
  });
  registerAction("nextProfile", nextProfile);
  registerAction("toggleZen", toggleZen);
  registerAction("attachFile", () => elements.attachButton?.click());
  registerAction("toggleWorkspace", () => elements.workspaceToggle?.click());
  registerAction("quickOpen", () => elements.workspaceToggle?.click());
  setKeymap(store.get("keymap"));
  bindGlobalShortcuts();
  store.on("keymap", () => setKeymap(store.get("keymap")));

  // chips
  refreshChips();
  refreshRagPill();
  toggleEmptyState();

  // history
  await refreshSidebar();

  // first model load
  loadModels().catch(() => {});
}

init().catch((err) => {
  console.error(err);
  toast(`Erro: ${err.message}`, "error", 6000);
});
