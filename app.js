/* Offline AI Chat — entry. Wires modules together. */

import { createStore, debounce } from "./modules/store.js";
import {
  loadAndMigrate, persist, defaults, defaultSampling, migrationFlags,
} from "./modules/schema.js";
import { conversationStore } from "./modules/storage.js";
import {
  normalizeBaseUrl, listModels, requestCompletion,
  formatFetchError, buildSamplingPayload,
  extractToolCalls, extractFinishReason, cronList,
} from "./modules/api.js";
import {
  getOpenAIToolDefinitions, executeTool,
} from "./modules/tools/manager.js";
import { applyAppearance } from "./modules/theme.js";
import {
  registerAction, setKeymap, bindGlobalShortcuts,
} from "./modules/shortcuts.js";
import { renderMarkdown, estimateTokens } from "./modules/markdown.js";
import { initToasts, toast } from "./modules/ui/toasts.js";
import {
  initChat, renderMessage, renderAllMessages,
  setBodyContent, appendStreamingDelta, finalizeAssistant,
  scrollToBottom, startGenerationTimer, stopGenerationTimer,
  renderToolCallBlock, showToolProgress,
} from "./modules/ui/chat.js";
import { forkMessagesAt, createFork } from "./modules/ui/chat-helpers.js";
import { getAlternativeProfiles, replaceMessageContent } from "./modules/ui/chat-helpers.js";
import {
  initComposer, clearComposer, focusComposer, setBusy as setComposerBusy,
  setComposerValue, setHistoryTokens, getPendingImage, clearPendingImage, insertPromptText
} from "./modules/ui/composer.js";
import { buildImageMessageContent } from "./modules/ui/composer-helpers.js";
import { initSidebar, refreshSidebar, setActiveConversation, toggleSidebar, closeSidebar } from "./modules/ui/sidebar.js";
import { initPalette, openPalette } from "./modules/ui/palette.js";
import { openPromptPicker } from "./modules/ui/prompt-picker.js";
import { initSettings, openSettings, closeSettings, setModelOptions } from "./modules/ui/settings.js";
import { initWorkspace, preprocessSlashCommands } from "./modules/ui/workspace.js";
import {
  injectContextIntoMessage, isPersistAcrossMessages, clearFiles, listFiles,
} from "./modules/workspace/context.js";
import * as rag from "./modules/rag/manager.js";
import { detectQueryStrategy } from "./modules/rag/strategy.js";
import { templateStore, createTemplate, initConversationFromTemplate } from "./modules/templates.js";
import { ragIndicatorShouldShow, shouldShowServerDropdown, nextServerIndex, shouldAutoScroll, getScrollPosition } from "./modules/app-helpers.js";
import { getBodyOverflowForModal } from "./modules/ui/chat-helpers.js";
import { exportConversation } from "./modules/exporter.js";
import { initNotifications, notifyResponseComplete, notifyDigestReady } from "./modules/notifications.js";
import {
  initComparison, openComparison, closeComparison, isComparisonActive,
} from "./modules/ui/comparison.js";

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
  ragIndexingIndicator: $("#ragIndexingIndicator"),
  moreButton: $("#moreButton"),
  moreMenu: $("#moreMenu"),
  workspaceToggle: $("#workspaceToggle"),
  compareToggle: $("#compareToggle"),
  paletteButton: $("#paletteButton"),
  settingsButton: $("#settingsButton"),
  comparisonView: $("#comparisonView"),
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

/* ---------- scroll position cache ---------- */
const scrollCache = new Map(); // conversationId → scrollTop



const runtime = {
  abortController: null,
  busy: false,
  currentConversation: null, // { id, title, messages, ... }
  models: [],
  abState: null, // { messageId, originalContent, alternativeContent, alternativeProfileId, node, body }
};

/* ---------- helpers ---------- */

/* Suggestion chips catalog — contextual to active profile */
const SUGGESTION_CATALOG = {
  dev: [
    { label: "Revisar este código", prompt: "Revise o código a seguir e aponte melhorias de qualidade, performance e segurança:\n\n" },
    { label: "Escrever testes", prompt: "Escreva testes unitários para o código a seguir, cobrindo casos de sucesso e de erro:\n\n" },
    { label: "Explicar este erro", prompt: "Explique o seguinte erro e sugira como corrigi-lo:\n\n" },
    { label: "Refatorar função", prompt: "Refatore a função a seguir para melhorar legibilidade e manutenibilidade:\n\n" },
    { label: "Documentar código", prompt: "Adicione documentação clara (JSDoc/docstring) ao código a seguir:\n\n" },
  ],
  general: [
    { label: "Resumir um texto", prompt: "Resuma o seguinte texto de forma clara e objetiva:\n\n" },
    { label: "Planejar estudos", prompt: "Crie um plano de estudos objetivo para aprender " },
    { label: "Escrever melhor", prompt: "Me ajude a reescrever o seguinte trecho de forma mais clara e direta:\n\n" },
    { label: "Brainstorm de ideias", prompt: "Me ajude a gerar ideias criativas para o seguinte problema:\n\n" },
    { label: "Analisar prós e contras", prompt: "Liste os prós e contras da seguinte decisão:\n\n" },
  ],
};

const DEV_KEYWORDS = [
  "código", "code", "engenheiro", "engineer", "developer", "desenvolvedor",
  "python", "typescript", "javascript", "react", "vue", "angular", "rust", "go", "java",
  "programação", "programming", "software", "api", "backend", "frontend", "fullstack",
  "debug", "teste", "test", "função", "function", "classe", "class", "script",
];

function classifyProfile(profile) {
  if (!profile?.systemPrompt) return "general";
  const lower = profile.systemPrompt.toLowerCase();
  return DEV_KEYWORDS.some((kw) => lower.includes(kw)) ? "dev" : "general";
}

function getChipsForProfile(profile) {
  const category = classifyProfile(profile);
  return SUGGESTION_CATALOG[category].slice(0, 3);
}

function refreshSuggestionChips() {
  const container = elements.emptyState?.querySelector(".suggestions");
  if (!container) return;
  const profile = getActiveProfile();
  const chips = getChipsForProfile(profile);
  container.replaceChildren();
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-chip";
    btn.dataset.prompt = chip.prompt;
    btn.textContent = chip.label;
    btn.addEventListener("click", () => {
      setComposerValue(chip.prompt);
      focusComposer();
    });
    container.appendChild(btn);
  }
}

function getActiveServer() {
  const conn = store.get("connection");
  return conn.servers.find((s) => s.id === conn.activeServerId) || conn.servers[0];
}

function getActiveProfile() {
  const profiles = store.get("profiles") || [];
  const id = store.get("activeProfileId");
  return profiles.find((p) => p.id === id) || profiles[0];
}

function compactModelName(model) {
  if (!model) return "";
  const last = String(model).split("/").pop();
  return last.length > 32 ? `${last.slice(0, 29)}...` : last;
}

function refreshChips() {
  const profile = getActiveProfile();
  elements.modelChipLabel.textContent = profile?.defaultModel || "Sem modelo";
  elements.profileChipLabel.textContent = profile ? `${profile.icon || ""} ${profile.name}`.trim() : "Perfil";
  if (elements.promptInput) {
    const model = compactModelName(profile?.defaultModel);
    elements.promptInput.placeholder = model ? `Mensagem para ${model}...` : "Mensagem para o modelo atual...";
  }
  refreshSuggestionChips();
}

function setStatus(kind, label) {
  elements.statusDot.className = `dot ${kind || ""}`.trim();
  elements.statusLabel.textContent = label;
  const descriptions = {
    connected: "Conectado ao servidor ativo.",
    connecting: "Tentando conectar ao servidor ativo.",
    error: "Falha na conexao. Clique para trocar servidor ou ajustar a URL.",
  };
  const detail = descriptions[kind] || "Sem conexao. Clique para configurar o servidor.";
  elements.statusPill.title = `${label} - ${detail}`;
  elements.statusPill.setAttribute("aria-label", `Estado da conexao: ${label}. ${detail}`);
}

function toggleEmptyState() {
  const has = elements.messagesInner.querySelector(".msg") !== null;
  elements.emptyState.classList.toggle("hidden", has);
}

/* ---------- conversations ---------- */

function newConversation(templateId = null) {
  const templates = templateStore.list();

  // If a specific template was requested, apply it directly
  if (templateId) {
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      const base = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: `(${tpl.name})`,
        profileId: store.get("activeProfileId"),
        serverId: store.get("connection.activeServerId"),
        model: getActiveProfile()?.defaultModel,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      runtime.currentConversation = initConversationFromTemplate(tpl, base);
      renderAllMessages(runtime.currentConversation.messages || []);
      toggleEmptyState();
      setActiveConversation(runtime.currentConversation.id);
      setHistoryTokens(0);
      return;
    }
  }

  // If templates exist and no specific one was requested, show selector
  if (templates.length > 0 && templateId === null) {
    showTemplateSelector(templates);
    return;
  }

  // Plain new conversation
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

function showTemplateSelector(templates) {
  const existing = document.getElementById("template-selector");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.id = "template-selector";
  menu.className = "palette-list";
  menu.style.position = "fixed";
  menu.style.background = "var(--bg-0)";
  menu.style.border = "1px solid var(--line)";
  menu.style.borderRadius = "var(--r-md)";
  menu.style.padding = "var(--s-1)";
  menu.style.boxShadow = "var(--shadow-3)";
  menu.style.zIndex = "30";
  menu.style.minWidth = "240px";
  menu.style.maxHeight = "320px";
  menu.style.overflowY = "auto";

  // Header
  const header = document.createElement("div");
  header.style.padding = "var(--s-2) var(--s-3)";
  header.style.fontSize = "var(--fs-xs)";
  header.style.color = "var(--fg-2)";
  header.style.fontWeight = "600";
  header.style.textTransform = "uppercase";
  header.style.letterSpacing = "0.06em";
  header.textContent = "Iniciar com template";
  menu.appendChild(header);

  // Blank option
  const blankBtn = document.createElement("button");
  blankBtn.type = "button";
  blankBtn.className = "palette-item";
  blankBtn.style.width = "100%";
  blankBtn.style.textAlign = "left";
  blankBtn.textContent = "Em branco";
  blankBtn.addEventListener("click", () => { menu.remove(); newConversation("__blank__"); });
  menu.appendChild(blankBtn);

  // Template options
  for (const tpl of templates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-item";
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    const nameEl = document.createElement("span");
    nameEl.textContent = tpl.name;
    const countEl = document.createElement("span");
    countEl.style.color = "var(--fg-2)";
    countEl.style.fontSize = "var(--fs-xs)";
    countEl.style.marginLeft = "var(--s-2)";
    countEl.textContent = `${(tpl.messages || []).length} msg(s)`;
    btn.appendChild(nameEl);
    btn.appendChild(countEl);
    btn.addEventListener("click", () => { menu.remove(); newConversation(tpl.id); });
    menu.appendChild(btn);
  }

  // Position near the new chat button
  const anchor = elements.newChatButton;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
  } else {
    menu.style.left = "16px";
    menu.style.top = "60px";
  }
  document.body.appendChild(menu);

  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
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
  // Restore scroll position if cached, otherwise scroll to bottom
  requestAnimationFrame(() => {
    const saved = getScrollPosition(scrollCache, id);
    if (saved !== null) {
      elements.messages.scrollTop = saved;
    } else {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }
  });
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
  for (const m of runtime.currentConversation.messages) {
    const content = Array.isArray(m.content)
      ? m.content.filter((p) => p.type === "text").map((p) => p.text).join(" ")
      : (m.content || "");
    total += estimateTokens(content);
  }
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

/* ---------- context window/RAG application flow ---------- */

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
    strategy = await detectQueryStrategy(rawText, meta.fileCount || 1, server, profile, store);
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
    const retrievalResult = await rag.retrieve({
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
      rerankConfig: ragCfg.reranking || null,
      signal: runtime.abortController?.signal,
    });
    const results = retrievalResult.chunks;
    runtime.lastRerankApplied = retrievalResult._rerankApplied;
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

  // Reranking status
  const rerankCfg = ragCfg.reranking;
  const isRerankEnabled = rerankCfg?.enabled && rerankCfg?.rerankModel;
  let rerankSuffix = "";
  let titleRerankStr = "";
  if (isRerankEnabled) {
    if (runtime.lastRerankApplied === false) {
      rerankSuffix = " + rerank ⚠";
      titleRerankStr = " · Reranking falhou na última consulta — usando ordem por cosine similarity";
    } else {
      rerankSuffix = " + rerank";
    }
  }

  // All good
  setState("ready", `RAG · ${meta.chunkCount} chunks${rerankSuffix}`,
    ragCfg.activeForNextMessage
      ? `RAG ativo · ${meta.chunkCount} chunks de ${meta.fileCount} arquivos${titleRerankStr} · clique pra desativar nesta mensagem`
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
  if (!model && runtime.models.length) {
    const first = runtime.models[0];
    model = typeof first === "string" ? first : first.id;
  }
  if (!model) {
    try {
      await loadModels();
      const first = runtime.models[0];
      model = profile.defaultModel || (typeof first === "string" ? first : first?.id);
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

  // user message — check for pending image
  const pendingImg = getPendingImage();
  let userMsgContent;
  if (pendingImg) {
    userMsgContent = buildImageMessageContent(rawText, pendingImg.base64, pendingImg.mimeType);
  } else {
    userMsgContent = rawText;
  }
  const userMsg = { role: "user", content: userMsgContent, ts: Date.now(), id: `m-${Date.now()}-u` };
  runtime.currentConversation.messages.push(userMsg);
  renderMessage(userMsg);
  toggleEmptyState();
  clearComposer();
  if (pendingImg) clearPendingImage();

  // assistant placeholder — IMPORTANT: also push to conversation so it persists
  const assistantMsg = { role: "assistant", content: "", ts: Date.now(), id: `m-${Date.now()}-a` };
  runtime.currentConversation.messages.push(assistantMsg);
  const { body: assistantBody } = renderMessage(assistantMsg, { streaming: true });

  // start generation timer
  const timerHandle = startGenerationTimer(assistantBody);

  // build payload
  const useStreaming = store.get("advanced.streaming");
  const sampling = buildSamplingPayload(profile.sampling);
  const messages = [];
  const sysPrompt = buildEffectiveSystemPrompt(profile);
  if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
  for (const m of runtime.currentConversation.messages.slice(0, -1)) {
    messages.push({ role: m.role, content: m.content });
  }
  // replace last user with potentially-injected version
  messages.push({ role: "user", content: userContent });

  const profileTools = getOpenAIToolDefinitions(store.get("tools") || [], profile.tools || []);
  const payload = {
    messages,
    model,
    stream: useStreaming,
    ...sampling,
    ...(profileTools ? { tools: profileTools } : {})
  };
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
        timerHandle.setTokenCount(estimateTokens(full.content));
      }
    );
    assistantContent = result.content;
    assistantReasoning = result.reasoning;
    usage = result.usage;
    finishReason = result.finishReason;

    // Tool calls têm prioridade sobre QUALQUER diagnóstico de conteúdo vazio.
    // Modelos chamando ferramenta legitimamente emitem `content=""` e
    // `finish_reason=tool_calls` — o auto-fix de max_tokens não deve disparar.
    if (finishReason === "tool_calls" || result.toolCalls) {
      const toolCalls = result.toolCalls || extractToolCalls(result);
      if (toolCalls && toolCalls.length) {
        stopGenerationTimer(timerHandle);
        assistantMsg.tool_calls = toolCalls;
        await runToolCycle(toolCalls, assistantBody, assistantMsg, {
          baseUrl, apiKey: server.apiKey, model, profile, sampling, useStreaming
        });
        return; // runToolCycle handles the next assistant turn
      }
    }

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

    stopGenerationTimer(timerHandle);

    finalizeAssistant(assistantBody, assistantContent, false, assistantReasoning, { usage, finishReason, elapsed: timerHandle.getElapsed() });
    assistantMsg.content = assistantContent;
    if (assistantReasoning) assistantMsg.reasoning = assistantReasoning;
    notifyResponseComplete();
    setStatus("connected", "Pronto");
  } catch (error) {
    if (error?.name === "AbortError") {
      const interrupted = assistantContent ? `${assistantContent}\n\n[Interrompido]` : "Interrompido.";
      stopGenerationTimer(timerHandle);
      finalizeAssistant(assistantBody, interrupted, false, assistantReasoning, { elapsed: timerHandle.getElapsed() });
      assistantMsg.content = interrupted;
      if (assistantReasoning) assistantMsg.reasoning = assistantReasoning;
      setStatus("connected", "Interrompido");
    } else {
      const detail = formatFetchError(error);
      stopGenerationTimer(timerHandle);
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

/**
 * Pede confirmação ao usuário antes de executar uma tool call. Usa <dialog>
 * nativo (zero deps). Resolve com true se aprovado, false se cancelado.
 *
 * Acionado quando `advanced.tools.requireConfirmation` está ligado. O nome da
 * tool e os argumentos brutos (JSON) são mostrados.
 */
function confirmToolCall(toolCall) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "tool-confirm-dialog";
    dlg.innerHTML = `
      <form method="dialog" class="tool-confirm-form">
        <h3 class="tool-confirm-title">Executar ferramenta?</h3>
        <p class="tool-confirm-name"><strong>${escapeHtml(toolCall.function.name)}</strong></p>
        <div class="tool-confirm-args-label">Argumentos:</div>
        <pre class="tool-confirm-args"></pre>
        <menu class="tool-confirm-actions">
          <button type="submit" value="cancel" class="btn btn-secondary">Cancelar</button>
          <button type="submit" value="ok" class="btn btn-primary">Executar</button>
        </menu>
      </form>
    `;
    // Args como textContent (escape automático de tags) em vez de innerHTML.
    const argsPre = dlg.querySelector(".tool-confirm-args");
    try {
      argsPre.textContent = JSON.stringify(JSON.parse(toolCall.function.arguments || "{}"), null, 2);
    } catch {
      argsPre.textContent = String(toolCall.function.arguments || "");
    }
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => {
      const approved = dlg.returnValue === "ok";
      dlg.remove();
      resolve(approved);
    }, { once: true });
    if (typeof dlg.showModal === "function") dlg.showModal();
    else { dlg.setAttribute("open", "true"); /* fallback */ }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/**
 * Constrói o system prompt efetivo: o que o usuário escreveu no perfil + uma
 * orientação automática sobre as ferramentas ativas. UX: o usuário liga
 * `web_search` no perfil e o modelo passa a chamá-la sem precisar ouvir
 * "use web_search" em toda pergunta.
 *
 * Não modifica `profile.systemPrompt` armazenado — só constrói a versão
 * efetiva no momento do envio.
 */
function buildEffectiveSystemPrompt(profile) {
  const base = profile.systemPrompt || "";
  const enabledIds = profile.tools || [];
  if (!enabledIds.length) return base;
  const allTools = store.get("tools") || [];
  const enabled = enabledIds.map(id => allTools.find(t => t.id === id)).filter(Boolean);
  if (!enabled.length) return base;

  const hints = [];
  for (const tool of enabled) {
    if (tool.name === "web_search") {
      hints.push(
        "- `web_search(query)` — Use proativamente quando o usuário pedir dados em tempo real ou recentes: " +
        "cotações, preços, notícias, datas atuais, versões de software, eventos. Cite as URLs das fontes na resposta. " +
        "Se a busca retornar erro (anti-bot, timeout, sem resultados), **NÃO chame de novo** — uma nova query não " +
        "vai resolver o problema. Apenas reporte ao usuário o que aconteceu em português claro, e se o erro mencionar " +
        "anti-bot/CAPTCHA sugira configurar uma chave Brave Search em Configurações → Avançado."
      );
    } else if (tool.name === "get_current_datetime") {
      hints.push("- `get_current_datetime()` — Use quando precisar saber data ou hora atual.");
    } else if (tool.name === "run_javascript") {
      hints.push("- `run_javascript(code)` — Use para cálculos numéricos precisos ou processamento de strings que exigem exatidão. Sem acesso a DOM/rede.");
    } else {
      const desc = tool.description ? `: ${tool.description}` : "";
      hints.push(`- \`${tool.name}\` — Use quando apropriado${desc}`);
    }
  }

  const orientation =
    "\n\nFerramentas disponíveis (chame proativamente sem esperar instrução explícita):\n" +
    hints.join("\n");
  return base + orientation;
}

/**
 * Remove os markers internos `__WEB_SEARCH_OK__:provider:` ou
 * `__WEB_SEARCH_ERROR__:code:braveStatus:` antes de mostrar o resultado pro
 * LLM. Os markers existem só pra UI conseguir renderizar caixa de erro/chip
 * de provider — o modelo recebe texto limpo. O caller guarda a versão com
 * marker em `_display` no tool message para que o re-render do histórico
 * mantenha a UI rica.
 */
function stripWebSearchMarker(result) {
  if (typeof result !== "string") return result;
  if (result.startsWith("__WEB_SEARCH_OK__:")) {
    const rest = result.slice("__WEB_SEARCH_OK__:".length);
    const colon = rest.indexOf(":");
    return colon >= 0 ? rest.slice(colon + 1) : rest;
  }
  if (result.startsWith("__WEB_SEARCH_ERROR__:")) {
    // Formato: __WEB_SEARCH_ERROR__:<code>:<braveStatus>:<msg>
    const rest = result.slice("__WEB_SEARCH_ERROR__:".length);
    const parts = rest.split(":");
    parts.shift(); // code
    parts.shift(); // braveStatus
    return `Erro na busca: ${parts.join(":")}`;
  }
  return result;
}

/**
 * Ciclo de execução de ferramentas e nova inferência.
 */
async function runToolCycle(toolCalls, assistantBody, assistantMsg, context, depth = 1) {
  if (depth > 5) {
    finalizeAssistant(assistantBody, "Erro: limite de 5 iterações de ferramentas excedido para evitar loops infinitos.", true);
    return;
  }
  // Bail-out preguiçoso: se o usuário já apertou Stop entre iterações, não
  // gastar uma nova rodada de inferência só pra cancelar no meio.
  if (runtime.abortController?.signal?.aborted) {
    finalizeAssistant(assistantBody, "Interrompido.", false);
    return;
  }

  const allTools = store.get("tools") || [];
  const requireConfirm = store.get("advanced.tools.requireConfirmation");

  // Trava anti-retry: se algum web_search falhou neste ciclo, vamos sumarizar
  // pro usuário e proibir uma nova chamada de tool. O modelo às vezes ignora
  // a orientação textual e tenta de novo — esta trava é determinística.
  let hadFailedWebSearch = false;

  // 1. Executar ferramentas
  const toolMessages = [];
  for (const tc of toolCalls) {
    if (runtime.abortController?.signal?.aborted) {
      finalizeAssistant(assistantBody, "Interrompido durante execução de ferramentas.", false);
      return;
    }
    const block = renderToolCallBlock(assistantBody, tc);

    if (requireConfirm) {
      const approved = await confirmToolCall(tc);
      if (!approved) {
        renderToolCallBlock(assistantBody, tc, "(cancelado pelo usuário)", block);
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: "Cancelado pelo usuário."
        });
        continue;
      }
    }

    const result = await executeTool(tc, allTools, {
      signal: runtime.abortController?.signal,
      braveApiKey: store.get("advanced.search.braveApiKey") || "",
    });

    // Atualiza o bloco existente in-place (display preserva markers de UI).
    renderToolCallBlock(assistantBody, tc, result, block);

    // Detectar falha de web_search pra travar retry determinístico.
    if (typeof result === "string" && result.startsWith("__WEB_SEARCH_ERROR__:")) {
      hadFailedWebSearch = true;
    }

    // O modelo recebe versão limpa (sem markers), mas guardamos `_display`
    // para o re-render do histórico mostrar UI rica (caixa de erro / chip
    // de provider) em vez de texto cru.
    toolMessages.push({
      role: "tool",
      tool_call_id: tc.id,
      name: tc.function.name,
      content: stripWebSearchMarker(result),
      _display: result,
    });
  }

  // Adiciona as tool messages ao histórico real da conversa
  runtime.currentConversation.messages.push(...toolMessages);
  
  // 2. Nova inferência com os resultados
  showToolProgress(assistantBody);
  
  const messages = [];
  const sysPrompt = buildEffectiveSystemPrompt(context.profile);
  if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
  // Inclui todo o histórico atualizado (incluindo a assistant msg com tool_calls e as tool results)
  for (const m of runtime.currentConversation.messages) {
    const msg = { role: m.role, content: m.content || "" };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.role === "tool") msg.tool_call_id = m.tool_call_id;
    messages.push(msg);
  }

  const profileTools = getOpenAIToolDefinitions(allTools, context.profile.tools || []);
  const payload = {
    messages,
    model: context.model,
    stream: context.useStreaming,
    ...context.sampling,
    ...(profileTools ? { tools: profileTools } : {})
  };

  const nextAssistantMsg = { role: "assistant", content: "", ts: Date.now(), id: `m-${Date.now()}-a` };
  runtime.currentConversation.messages.push(nextAssistantMsg);
  
  const timerHandle = startGenerationTimer(assistantBody);
  let nextContent = "";
  let nextReasoning = "";

  try {
    const result = await requestCompletion(
      { baseUrl: context.baseUrl, apiKey: context.apiKey, payload, signal: runtime.abortController?.signal },
      (_delta, full) => {
        nextContent = full.content;
        nextReasoning = full.reasoning;
        appendStreamingDelta(assistantBody, full.content, full.reasoning);
        timerHandle.setTokenCount(estimateTokens(full.content));
      }
    );

    stopGenerationTimer(timerHandle);

    // Recursão se houver mais tool_calls — MAS bloqueada se já tivemos falha
    // de web_search neste ciclo. Sem isso o modelo às vezes ignora a orientação
    // textual e retenta 3-4 vezes, gerando ruído na UI.
    const nextFinishReason = result.finishReason || extractFinishReason(result);
    if ((nextFinishReason === "tool_calls" || result.toolCalls) && !hadFailedWebSearch) {
      const nextToolCalls = result.toolCalls || extractToolCalls(result);
      if (nextToolCalls) {
        nextAssistantMsg.tool_calls = nextToolCalls;
        await runToolCycle(nextToolCalls, assistantBody, nextAssistantMsg, context, depth + 1);
        return;
      }
    } else if (hadFailedWebSearch && (nextFinishReason === "tool_calls" || result.toolCalls)) {
      // Modelo quis chamar tool de novo após falha — corta e mostra mensagem
      // útil pro usuário ao invés de deixar ele em loop silencioso.
      const fallbackMsg =
        (result.content && result.content.trim()) ||
        "Não consegui buscar essa informação online (anti-bot/timeout). " +
        "Configure uma chave Brave Search em Configurações → Avançado para uma busca mais confiável.";
      finalizeAssistant(assistantBody, fallbackMsg, false, result.reasoning, {
        usage: result.usage,
        finishReason: "stopped-by-app",
        elapsed: timerHandle.getElapsed(),
      });
      nextAssistantMsg.content = fallbackMsg;
      if (result.reasoning) nextAssistantMsg.reasoning = result.reasoning;
      notifyResponseComplete();
      saveCurrentConversation();
      recomputeHistoryTokens();
      setStatus("connected", "Pronto");
      return;
    }

    finalizeAssistant(assistantBody, result.content, false, result.reasoning, {
      usage: result.usage, 
      finishReason: nextFinishReason, 
      elapsed: timerHandle.getElapsed() 
    });
    nextAssistantMsg.content = result.content;
    if (result.reasoning) nextAssistantMsg.reasoning = result.reasoning;
    
    notifyResponseComplete();
    saveCurrentConversation();
    recomputeHistoryTokens();
    setStatus("connected", "Pronto");

  } catch (err) {
    stopGenerationTimer(timerHandle);
    finalizeAssistant(assistantBody, `Erro no ciclo de ferramentas: ${err.message}`, true);
    setStatus("error", "Erro");
  }
}

/* ---------- conversation list actions ---------- */

async function handleSidebarAction({ action, conversation }) {
  if (action === "rename") {
    // Inline rename is handled directly in sidebar.js — this branch is a fallback
    // for cases where the DOM element is not available (e.g., element was removed)
    const next = prompt("Novo título:", conversation.title);
    if (next && next.trim()) {
      conversation.title = next.trim();
      conversation.updatedAt = Date.now();
      await conversationStore.upsert(conversation);
      refreshSidebar();
    }
  } else if (action === "rename-done") {
    // Inline rename completed in sidebar.js — sync runtime state if this is the active conversation
    if (runtime.currentConversation?.id === conversation.id) {
      runtime.currentConversation.title = conversation.title;
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
    const conv = await conversationStore.get(conversation.id) || conversation;
    exportConversation(conv, "md", toast);
  } else if (action === "export-html") {
    const conv = await conversationStore.get(conversation.id) || conversation;
    exportConversation(conv, "html", toast);
  } else if (action === "save-template") {
    const name = prompt("Nome do template:", conversation.title || "Meu template");
    if (!name || !name.trim()) return;
    const profile = getActiveProfile();
    const tpl = createTemplate(conversation, name.trim(), profile?.systemPrompt || "");
    const existing = templateStore.list();
    templateStore.save([...existing, tpl]);
    toast(`Template "${name.trim()}" salvo.`, "success");
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

/* ---------- A/B comparison helpers ---------- */

function showProfileSelector(profiles, message, node, body) {
  const existing = document.getElementById("ab-profile-selector");
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.id = "ab-profile-selector";
  menu.className = "palette-list";
  menu.style.position = "fixed";
  menu.style.background = "var(--bg-0)";
  menu.style.border = "1px solid var(--line)";
  menu.style.borderRadius = "var(--r-md)";
  menu.style.padding = "var(--s-1)";
  menu.style.boxShadow = "var(--shadow-2)";
  menu.style.zIndex = "30";
  menu.style.minWidth = "220px";

  const title = document.createElement("div");
  title.style.padding = "var(--s-2) var(--s-3)";
  title.style.fontSize = "var(--fs-xs)";
  title.style.color = "var(--fg-2)";
  title.style.fontWeight = "600";
  title.textContent = "Selecionar perfil alternativo:";
  menu.appendChild(title);

  for (const profile of profiles) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "palette-item";
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.textContent = `${profile.icon || "👤"} ${profile.name}`;
    b.addEventListener("click", () => {
      menu.remove();
      generateABResponse(profile, message, node, body);
    });
    menu.appendChild(b);
  }

  // Position near the message node
  const rect = node.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left + 40, window.innerWidth - 240)}px`;
  menu.style.top = `${rect.top + 40}px`;
  document.body.appendChild(menu);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

async function generateABResponse(altProfile, message, node, body) {
  const conv = runtime.currentConversation;
  if (!conv) return;

  const server = getActiveServer();
  if (!server?.baseUrl) { toast("Configure um servidor primeiro.", "warn"); return; }
  let baseUrl;
  try { baseUrl = normalizeBaseUrl(server.baseUrl); } catch { toast("URL inválida.", "error"); return; }

  // Find the previous user message
  const idx = conv.messages.findIndex((m) => m.id === message.id);
  if (idx < 0) return;
  const previousUser = [...conv.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
  if (!previousUser) { toast("Mensagem do usuário não encontrada.", "warn"); return; }

  const originalContent = message.content;
  runtime.abState = { messageId: message.id, originalContent, node, body };

  // Build payload with alternative profile
  const sampling = buildSamplingPayload(altProfile.sampling);
  const messages = [];
  {
    const altSys = buildEffectiveSystemPrompt(altProfile);
    if (altSys) messages.push({ role: "system", content: altSys });
  }
  for (const m of conv.messages.slice(0, idx)) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: "user", content: previousUser.content });

  const model = altProfile.defaultModel || ((typeof runtime.models[0] === "string" ? runtime.models[0] : runtime.models[0]?.id) || "");
  const payload = { messages, model, stream: false, ...sampling };

  // Show loading state in A/B layout
  const abLayout = buildABLayout(message.id, originalContent, null, altProfile.name);
  node.insertAdjacentElement("afterend", abLayout);

  try {
    const result = await requestCompletion({ baseUrl, apiKey: server.apiKey, payload });
    const altContent = result.content || "(sem resposta)";
    runtime.abState.alternativeContent = altContent;
    runtime.abState.alternativeProfileId = altProfile.id;

    // Update A/B layout with the alternative content
    abLayout.remove();
    const finalLayout = buildABLayout(message.id, originalContent, altContent, altProfile.name, message, node, body);
    node.insertAdjacentElement("afterend", finalLayout);
  } catch (err) {
    abLayout.remove();
    runtime.abState = null;
    toast("Erro ao gerar resposta alternativa: " + err.message, "error");
  }
}

function buildABLayout(messageId, originalContent, altContent, altProfileName, message, node, body) {
  const wrap = document.createElement("div");
  wrap.id = `ab-${messageId}`;
  wrap.className = "ab-comparison";

  const activeProfile = getActiveProfile();

  // Column A — original
  const colA = document.createElement("div");
  colA.className = "ab-col";
  const headerA = document.createElement("div");
  headerA.className = "ab-col-header";
  headerA.textContent = `Perfil: ${activeProfile?.name || "Atual"}`;
  const bodyA = document.createElement("div");
  bodyA.className = "msg-body";
  if (originalContent) {
    try { bodyA.appendChild(renderMarkdown(originalContent)); }
    catch { bodyA.textContent = originalContent; }
  }
  colA.appendChild(headerA);
  colA.appendChild(bodyA);

  // Column B — alternative
  const colB = document.createElement("div");
  colB.className = "ab-col";
  const headerB = document.createElement("div");
  headerB.className = "ab-col-header";
  headerB.textContent = `Perfil: ${altProfileName}`;
  const bodyB = document.createElement("div");
  bodyB.className = "msg-body";
  if (altContent) {
    try { bodyB.appendChild(renderMarkdown(altContent)); }
    catch { bodyB.textContent = altContent; }
  } else {
    bodyB.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  }
  colB.appendChild(headerB);
  colB.appendChild(bodyB);

  wrap.appendChild(colA);
  wrap.appendChild(colB);

  // Action buttons (only when both responses are available)
  if (altContent && message && node && body) {
    const actionsRow = document.createElement("div");
    actionsRow.className = "ab-actions";

    const useA = document.createElement("button");
    useA.type = "button";
    useA.className = "btn btn-sm btn-secondary";
    useA.textContent = "Usar esta (original)";
    useA.addEventListener("click", () => {
      handleMessageAction({ action: "ab-choose", message: { id: messageId, chosenContent: originalContent }, node, body });
    });

    const useB = document.createElement("button");
    useB.type = "button";
    useB.className = "btn btn-sm btn-primary";
    useB.textContent = "Usar esta (alternativa)";
    useB.addEventListener("click", () => {
      handleMessageAction({ action: "ab-choose", message: { id: messageId, chosenContent: altContent }, node, body });
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-sm btn-ghost";
    cancel.textContent = "Cancelar";
    cancel.addEventListener("click", () => {
      handleMessageAction({ action: "ab-cancel", message: { id: messageId }, node, body });
    });

    actionsRow.appendChild(useA);
    actionsRow.appendChild(useB);
    actionsRow.appendChild(cancel);
    wrap.appendChild(actionsRow);
  }

  return wrap;
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
  } else if (action === "edit-save") {
    // Inline editor saved — persist the updated content
    const conv = runtime.currentConversation;
    if (!conv) return;
    const msg = conv.messages.find((m) => m.id === message?.id);
    if (msg) {
      msg.content = message.content; // already updated by closeInlineEditor
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
  } else if (action === "fork") {
    const conv = runtime.currentConversation;
    if (!conv) return;
    try {
      const forkedMessages = forkMessagesAt(conv.messages, message.id);
      const newConv = createFork(conv, forkedMessages);
      await conversationStore.upsert(newConv);
      await refreshSidebar();
      await loadConversation(newConv.id);
      toast(`Fork criado: "${newConv.title}"`, "success");
    } catch (err) {
      toast("Erro ao criar fork: " + err.message, "error");
    }
  } else if (action === "ab-start") {
    if (runtime.busy) return;
    const conv = runtime.currentConversation;
    if (!conv) return;
    const profiles = store.get("profiles") || [];
    const activeProfileId = store.get("activeProfileId");
    const alternatives = getAlternativeProfiles(profiles, activeProfileId);
    if (!alternatives.length) {
      toast("Nenhum perfil alternativo disponível. Adicione perfis em Configurações.", "warn");
      return;
    }
    // Show profile selector dropdown
    showProfileSelector(alternatives, message, node, body);
  } else if (action === "ab-choose") {
    const conv = runtime.currentConversation;
    if (!conv || !runtime.abState) return;
    const { messageId, chosenContent } = message; // message here carries the chosen content
    const updated = replaceMessageContent(conv.messages, messageId, chosenContent);
    conv.messages = updated;
    await conversationStore.upsert(conv);
    // Remove A/B layout and re-render the message
    const abLayout = document.getElementById(`ab-${messageId}`);
    if (abLayout) abLayout.remove();
    // Re-render the original message node with new content
    if (runtime.abState?.node) {
      const msgObj = conv.messages.find((m) => m.id === messageId);
      if (msgObj) {
        setBodyContent(runtime.abState.body, msgObj.content, false);
      }
    }
    runtime.abState = null;
    toast("Resposta selecionada.", "success");
  } else if (action === "ab-cancel") {
    const abLayout = document.getElementById(`ab-${message.id}`);
    if (abLayout) abLayout.remove();
    runtime.abState = null;
  } else if (action === "focus") {
    openFocusModal(message);
  }
}

/* ---------- focus modal ---------- */

function openFocusModal(message) {
  const existing = document.getElementById("focus-modal-overlay");
  if (existing) existing.remove();

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = getBodyOverflowForModal(true, previousOverflow);

  const overlay = document.createElement("div");
  overlay.id = "focus-modal-overlay";
  overlay.className = "focus-modal-overlay";

  const content = document.createElement("div");
  content.className = "focus-modal-content";

  const header = document.createElement("div");
  header.className = "focus-modal-header";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn-sm btn-secondary";
  copyBtn.textContent = "Copiar";
  copyBtn.addEventListener("click", () => {
    const text = Array.isArray(message.content)
      ? message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
      : (message.content || "");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = "Copiado ✓";
        setTimeout(() => { copyBtn.textContent = "Copiar"; }, 2000);
      }).catch(() => toast("Não foi possível copiar.", "warn"));
    } else {
      toast("Clipboard não disponível.", "warn");
    }
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "icon-button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener("click", closeFocusModal);

  header.appendChild(copyBtn);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "focus-modal-body";
  // Render content
  const text = Array.isArray(message.content)
    ? message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
    : (message.content || "");
  try {
    body.appendChild(renderMarkdown(text));
  } catch {
    body.textContent = text;
  }

  content.appendChild(header);
  content.appendChild(body);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Close on overlay click (outside content)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeFocusModal();
  });

  // Close on Escape
  const onKeydown = (e) => {
    if (e.key === "Escape") { closeFocusModal(); document.removeEventListener("keydown", onKeydown); }
  };
  document.addEventListener("keydown", onKeydown);

  function closeFocusModal() {
    overlay.remove();
    document.body.style.overflow = getBodyOverflowForModal(false, previousOverflow);
    document.removeEventListener("keydown", onKeydown);
  }
}

/* ---------- server dropdown ---------- */

function openServerDropdown(servers, activeServerId) {
  const existing = document.getElementById("server-dropdown");
  if (existing) { existing.remove(); return; }

  const dropdown = document.createElement("div");
  dropdown.id = "server-dropdown";
  dropdown.className = "server-dropdown";

  let selectedIndex = servers.findIndex((s) => s.id === activeServerId);
  if (selectedIndex < 0) selectedIndex = 0;

  function renderItems() {
    dropdown.replaceChildren();
    servers.forEach((server, idx) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "server-dropdown-item" + (server.id === activeServerId ? " active" : "");
      item.dataset.idx = idx;

      const check = document.createElement("span");
      check.className = "server-dropdown-check";
      check.textContent = server.id === activeServerId ? "✓" : " ";

      const name = document.createElement("span");
      name.textContent = server.nickname || server.baseUrl || `Servidor ${idx + 1}`;

      item.appendChild(check);
      item.appendChild(name);
      item.addEventListener("click", () => {
        dropdown.remove();
        if (server.id !== activeServerId) {
          store.set("connection.activeServerId", server.id);
          loadModels().catch(() => {});
        }
      });
      dropdown.appendChild(item);
    });
  }

  renderItems();

  // Keyboard navigation
  dropdown.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = nextServerIndex(selectedIndex, servers.length, 1);
      dropdown.querySelectorAll(".server-dropdown-item")[selectedIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = nextServerIndex(selectedIndex, servers.length, -1);
      dropdown.querySelectorAll(".server-dropdown-item")[selectedIndex]?.focus();
    } else if (e.key === "Escape") {
      dropdown.remove();
    }
  });

  const rect = elements.statusPill.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(dropdown);

  // Focus first item
  requestAnimationFrame(() => dropdown.querySelector(".server-dropdown-item")?.focus());

  const close = (e) => {
    if (!dropdown.contains(e.target) && e.target !== elements.statusPill) {
      dropdown.remove();
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function toggleMoreMenu(forceOpen = null) {
  if (!elements.moreButton || !elements.moreMenu) return;
  const shouldOpen = forceOpen === null ? elements.moreMenu.hidden : forceOpen;
  elements.moreMenu.hidden = !shouldOpen;
  elements.moreButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

/* ---------- shortcuts ---------- */

function buildPaletteCommands() {
  const profiles = store.get("profiles") || [];
  const conn = store.get("connection");
  return [
    { label: "Nova conversa", group: "Chat", run: newConversation },
    { label: "Abrir Workspace", hint: "Ctrl+Shift+E", group: "Chat", run: () => elements.workspaceToggle?.click() },
    { label: "Comparar modelos", hint: "Ctrl+Shift+C", group: "Chat", run: () => elements.compareToggle?.click() },
    { label: "Biblioteca de prompts", hint: "Ctrl+Shift+P", group: "Chat", run: () => openPromptPicker(store, insertPromptText) },
    { label: "Limpar contexto do workspace", group: "Chat", run: () => clearFiles() },
    { label: "Configuracoes", hint: "Essencial", group: "Configuracoes", run: () => openSettings("basic") },
    { label: "Servidor", hint: "Configuracoes", group: "Configuracoes", run: () => openSettings("server") },
    { label: "Perfis e inferencia", hint: "Configuracoes", group: "Configuracoes", run: () => openSettings("profiles") },
    { label: "Workspace e RAG", hint: "Configuracoes", group: "Configuracoes", run: () => openSettings("workspace") },
    { label: "Ferramentas", hint: "Configuracoes", group: "Configuracoes", run: () => openSettings("tools") },
    { label: "Avancado", hint: "Configuracoes", group: "Configuracoes", run: () => openSettings("advanced") },
    { label: "Alternar tema", group: "Aparencia", run: toggleTheme },
    { label: "Alternar modo zen", group: "Aparencia", run: toggleZen },
    ...profiles.map((p) => ({
      label: `Perfil: ${p.name}`,
      hint: p.id === store.get("activeProfileId") ? "Ativo" : (p.defaultModel || ""),
      group: "Perfis",
      run: () => { store.set("activeProfileId", p.id); refreshChips(); toast(`Perfil: ${p.name}`, "info"); },
    })),
    ...conn.servers.map((s) => ({
      label: `Servidor: ${s.nickname}`, hint: s.baseUrl, group: "Servidores",
      run: () => { store.set("connection.activeServerId", s.id); loadModels().catch(() => {}); },
    })),
    ...runtime.models.map((m) => ({
      label: `Modelo: ${typeof m === "string" ? m : (m.name || m.id)}`, group: "Modelos",
      run: () => {
        const profile = getActiveProfile();
        profile.defaultModel = typeof m === "string" ? m : m.id;
        refreshChips();
        toast(`Modelo: ${typeof m === "string" ? m : (m.name || m.id)}`, "info");
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

  // Avisar usuário quando configurações foram migradas/atualizadas.
  // v1Migrated: schema antigo migrado pra v2 — alguns campos podem ter sido
  // perdidos (prompt library customizada, slash commands, etc) porque a
  // migração só cobre os campos críticos.
  // embeddingModelBumped: default trocado de nomic pra Qwen3 — index antigo
  // ficou inválido e usuário precisa re-indexar.
  if (migrationFlags.v1Migrated) {
    setTimeout(() => toast(
      "Configurações migradas para v2. Revise RAG, prompts e tools em Configurações — alguns campos voltaram ao default.",
      "info",
      9000
    ), 250);
  }
  if (migrationFlags.embeddingModelBumped) {
    setTimeout(() => toast(
      "Modelo de embedding default mudou para Qwen3-Embedding-4B. Re-indexe seus workspaces RAG.",
      "warn",
      9000
    ), 500);
  }

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
    getEmbedConfig: () => {
      try {
        const server = getActiveServer();
        const model = store.get("rag.embeddingModel");
        if (!model || !server?.baseUrl) return null;
        return {
          baseUrl: normalizeBaseUrl(server.baseUrl),
          apiKey: server.apiKey || "",
          model,
        };
      } catch {
        return null;
      }
    },
  });
  initPalette();
  initSettings({
    elements, store,
    onChange: () => { debouncedPersist(); refreshChips(); },
    onConnect: () => loadModels().catch(() => {}),
    onLoadModels: (server) => loadModels(server),
    onProfileChange: () => { refreshChips(); applyAppearance(store.get("appearance")); },
    conversationStore,
    toast,
    refreshSidebar,
  });
  initWorkspace({ store, elements, onChange: debouncedPersist });
  
  initComparison({
    store,
    elements,
    // Comparison precisa da lista de modelos sem acoplar a `window.runtime`
    // (bug anterior: window.runtime nunca foi exposto, então o select ficava
    // sempre vazio). Pull-based: re-puxa a cada openComparison.
    getModels: () => runtime.models || [],
    onUseResponse: async (conv) => {
      await conversationStore.upsert(conv);
      refreshSidebar();
      await loadConversation(conv.id);
    },
    onClose: () => {
      elements.compareToggle.setAttribute("aria-pressed", "false");
    },
  });

  elements.compareToggle.addEventListener("click", () => {
    if (isComparisonActive()) {
      closeComparison();
    } else {
      openComparison();
      elements.compareToggle.setAttribute("aria-pressed", "true");
    }
  });

  // Ponte: erros estruturados de tool (chat.js) pedem pra abrir Settings com
  // âncora específica. Mantém o chat desacoplado da implementação do drawer.
  document.addEventListener("open-settings", (ev) => {
    const { tab, anchor } = ev.detail || {};
    openSettings(tab || "advanced");
    if (anchor) {
      requestAnimationFrame(() => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  });

  registerAction("compare-mode", "Alternar modo de comparação", "Ctrl+Shift+C", () => {
    elements.compareToggle.click();
  });

  // topbar
  elements.sidebarToggle.addEventListener("click", toggleSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);
  elements.profileChip.addEventListener("click", () => openSettings("basic"));
  elements.modelChip.addEventListener("click", () => openSettings("basic"));
  elements.statusPill.addEventListener("click", () => {
    const conn = store.get("connection");
    const servers = conn.servers || [];
    if (shouldShowServerDropdown(servers)) {
      openServerDropdown(servers, conn.activeServerId);
    } else {
      openSettings("server");
    }
  });
  if (elements.ragIndexingIndicator) {
    elements.ragIndexingIndicator.addEventListener("click", () => openSettings("workspace"));
  }
  elements.settingsButton.addEventListener("click", () => openSettings());
  elements.paletteButton.addEventListener("click", () => openPalette(buildPaletteCommands()));
  if (elements.moreButton && elements.moreMenu) {
    elements.moreButton.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    });
    elements.moreMenu.addEventListener("click", () => toggleMoreMenu(false));
    document.addEventListener("click", (e) => {
      if (elements.moreMenu.hidden) return;
      if (e.target.closest?.(".topbar-more")) return;
      toggleMoreMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") toggleMoreMenu(false);
    });
  }

  // Notifications
  initNotifications({ store, toastFn: toast });

  // Poll leve: avisa quando uma tarefa agendada (boletim) conclui em background.
  // Só dispara se o motor estiver ativo no servidor e o usuário tiver habilitado.
  // lastSeenRunAt é a marca d'água; no 1º poll só estabelece baseline (sem avisar
  // execuções antigas).
  startCronCompletionPoll(store);

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
    // RAG indexing indicator in topbar
    if (elements.ragIndexingIndicator) {
      elements.ragIndexingIndicator.classList.toggle("hidden", !ragIndicatorShouldShow(evt.kind));
    }
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
  registerAction("openPromptPicker", () => openPromptPicker(store, insertPromptText));
  registerAction("toggleZen", toggleZen);
  registerAction("attachFile", () => document.dispatchEvent(new CustomEvent("composer:attach-file")));
  registerAction("toggleWorkspace", () => elements.workspaceToggle?.click());
  registerAction("quickOpen", () => elements.workspaceToggle?.click());
  setKeymap(store.get("keymap"));
  bindGlobalShortcuts();
  store.on("keymap", () => setKeymap(store.get("keymap")));

  // scroll position cache — save position on scroll with debounce
  const debouncedSaveScroll = debounce(() => {
    if (runtime.currentConversation) {
      scrollCache.set(runtime.currentConversation.id, elements.messages.scrollTop);
    }
  }, 150);
  elements.messages.addEventListener("scroll", debouncedSaveScroll);

  // F key shortcut — open focus modal for hovered message
  elements.messages.addEventListener("keydown", (e) => {
    if (e.key !== "f" && e.key !== "F") return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const target = e.target.closest ? e.target.closest(".msg") : null;
    if (!target) return;
    const msgId = target.dataset.id;
    if (!msgId || !runtime.currentConversation) return;
    const message = runtime.currentConversation.messages.find((m) => m.id === msgId);
    if (message) {
      e.preventDefault();
      handleMessageAction({ action: "focus", message, messageId: msgId, node: target, body: target.querySelector(".msg-body") });
    }
  });

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

/* Poll de conclusão de tarefas agendadas. Compara o lastFinishAt das tarefas
   contra a marca d'água store("cron").lastSeenRunAt e dispara notifyDigestReady
   para execuções OK novas. Intervalo de 60s; tolerante a falhas (servidor pode
   estar reiniciando). Não dispara nada no 1º poll (só estabelece baseline). */
function startCronCompletionPoll(store) {
  let primed = false;
  async function poll() {
    const pref = store.get("cron") || {};
    if (pref.notifyOnCompletion === false) return;
    let data;
    try { data = await cronList(); } catch { return; }
    if (!data || !data.enabled || !Array.isArray(data.tasks)) return;

    let maxFinish = Number(pref.lastSeenRunAt) || 0;
    const fresh = [];
    for (const t of data.tasks) {
      const fin = t.state && t.state.lastFinishAt ? t.state.lastFinishAt : 0;
      if (fin > maxFinish) maxFinish = fin;
      if (primed && fin > (Number(pref.lastSeenRunAt) || 0) && t.state.lastStatus === "ok" && t.options && t.options.notify) {
        fresh.push(t.name);
      }
    }
    for (const name of fresh) notifyDigestReady(name);
    if (maxFinish > (Number(pref.lastSeenRunAt) || 0)) {
      store.set("cron.lastSeenRunAt", maxFinish);
    }
    primed = true;
  }
  poll();
  setInterval(poll, 60_000);
}

// Service worker registrado aqui (em vez de inline em index.html) para
// permitir CSP estrita: script-src 'self' sem 'unsafe-inline'.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
