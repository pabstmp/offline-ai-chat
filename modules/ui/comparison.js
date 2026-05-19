/* Comparison Manager — orquestra o modo de comparação lado a lado. */

import { requestCompletion, normalizeBaseUrl, buildSamplingPayload } from "../api.js";
import { toast } from "./toasts.js";
import {
  appendStreamingDelta,
  finalizeAssistant,
  startGenerationTimer,
  stopGenerationTimer,
} from "./chat.js";
import {
  buildComparisonPayloads,
  groupModelsByServer,
  resolveServerForModel,
  buildConversationFromComparison,
} from "./comparison-helpers.js";

let isActive = false;
let store = null;
let elements = null;
let onUseResponse = null;
let onClose = null;
let getModels = () => [];

// Estado da sessão atual
let sessionState = {
  prompt: "",
  modelA: null,
  modelB: null,
  responseA: "",
  responseB: "",
  reasoningA: "",
  reasoningB: "",
  streamControllers: [null, null],
  timers: [null, null],
  busyA: false,
  busyB: false,
};

// Mapa modelId -> serverId para roteamento correto
const modelToServerId = new Map();

/**
 * Inicializa o Comparison_Manager.
 */
export function initComparison(opts) {
  store = opts.store;
  elements = opts.elements;
  onUseResponse = opts.onUseResponse || (() => {});
  onClose = opts.onClose || (() => {});
  getModels = opts.getModels || (() => []);
}

/**
 * Ativa o modo de comparação.
 */
export function openComparison() {
  if (isActive) return;
  isActive = true;

  // Limpa estado anterior
  sessionState = {
    prompt: "",
    modelA: null,
    modelB: null,
    responseA: "",
    responseB: "",
    reasoningA: "",
    reasoningB: "",
    streamControllers: [null, null],
    timers: [null, null],
    busyA: false,
    busyB: false,
  };

  // Renderiza a view básica (modelos são pull-based via getModels())
  renderComparisonView();

  // Pré-seleciona modelo ativo do perfil corrente no painel esquerdo
  const profile = store.get("profiles").find(p => p.id === store.get("activeProfileId"));
  if (profile?.defaultModel) {
    sessionState.modelA = profile.defaultModel;
    const selA = elements.comparisonView.querySelector('.comparison-panel[data-panel="0"] select');
    if (selA) selA.value = profile.defaultModel;
  }

  elements.comparisonView.classList.remove("hidden");
  const mainChat = document.querySelector("main.chat");
  if (mainChat) mainChat.classList.add("hidden");
  if (elements.messages) elements.messages.classList.add("hidden");
  if (elements.chatForm) elements.chatForm.classList.add("hidden");

  // Foca no composer
  const input = elements.comparisonView.querySelector("#comparisonInput");
  if (input) requestAnimationFrame(() => input.focus());
}

/**
 * Desativa o modo de comparação.
 */
export function closeComparison(force = false) {
  if (!isActive) return;

  if (!force && (sessionState.busyA || sessionState.busyB)) {
    if (!confirm("Há uma geração em andamento. Deseja interrompê-la e sair?")) {
      return;
    }
  }

  isActive = false;
  
  // Aborta streamings
  sessionState.streamControllers.forEach(c => c?.abort());
  sessionState.timers.forEach(t => stopGenerationTimer(t));

  elements.comparisonView.classList.add("hidden");
  const mainChat = document.querySelector("main.chat");
  if (mainChat) mainChat.classList.remove("hidden");
  if (elements.messages) elements.messages.classList.remove("hidden");
  if (elements.chatForm) elements.chatForm.classList.remove("hidden");

  onClose();
}

export function isComparisonActive() {
  return isActive;
}

/**
 * Renderiza a estrutura da Comparison_View.
 */
function renderComparisonView() {
  const container = elements.comparisonView;
  container.innerHTML = "";
  container.className = "comparison-view";

  // Cabeçalho unificado e moderno
  const header = document.createElement("div");
  header.className = "comparison-header";

  const title = document.createElement("h2");
  title.className = "comparison-title";
  title.textContent = "Comparação de Modelos";

  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-secondary btn-sm comparison-back-btn";
  backBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
    Voltar ao Chat
  `;
  backBtn.addEventListener("click", () => closeComparison());

  header.appendChild(title);
  header.appendChild(backBtn);
  container.appendChild(header);

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "comparison-panels";

  // Painel A e B
  panelsWrap.appendChild(buildPanel(0));
  panelsWrap.appendChild(buildPanel(1));

  container.appendChild(panelsWrap);
  container.appendChild(buildComposer());
}

function buildPanel(index) {
  const panel = document.createElement("div");
  panel.className = "comparison-panel";
  panel.dataset.panel = index;

  const header = document.createElement("div");
  header.className = "panel-header";

  const select = document.createElement("select");
  select.className = "model-select";
  populateModelSelect(select);
  select.addEventListener("change", (e) => {
    if (index === 0) sessionState.modelA = e.target.value;
    else sessionState.modelB = e.target.value;
    
    // Se mudar de modelo durante streaming, para o atual
    if (index === 0 && sessionState.busyA) abortPanel(0);
    if (index === 1 && sessionState.busyB) abortPanel(1);
  });
  
  if (index === 0) sessionState.modelA = select.value;
  else sessionState.modelB = select.value;

  header.appendChild(select);

  const modelLabel = document.createElement("span");
  modelLabel.className = "panel-model-label hidden";
  header.appendChild(modelLabel);

  const body = document.createElement("div");
  body.className = "panel-body";
  const messages = document.createElement("div");
  messages.className = "panel-messages";

  // Adiciona estado inicial vazio elegante (Empty State)
  const emptyState = document.createElement("div");
  emptyState.className = "panel-empty-state";
  emptyState.innerHTML = `
    <svg class="empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
    <div class="empty-title">Aguardando prompt</div>
    <div class="empty-desc">Selecione um modelo acima e escreva um prompt para iniciar a comparação.</div>
  `;
  messages.appendChild(emptyState);
  body.appendChild(messages);

  const footer = document.createElement("div");
  footer.className = "panel-footer";

  const stopBtn = document.createElement("button");
  stopBtn.className = "btn btn-sm btn-ghost panel-stop hidden";
  stopBtn.textContent = "Parar";
  stopBtn.addEventListener("click", () => abortPanel(index));

  const stats = document.createElement("div");
  stats.className = "panel-stats";

  const actions = document.createElement("div");
  actions.className = "panel-actions hidden";
  
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn btn-sm btn-ghost";
  copyBtn.textContent = "Copiar";
  copyBtn.addEventListener("click", () => {
    const text = index === 0 ? sessionState.responseA : sessionState.responseB;
    navigator.clipboard.writeText(text)
      .then(() => toast("Resposta copiada", "success", 1500))
      .catch(() => toast("Falha ao copiar", "error", 2500));
  });

  const useBtn = document.createElement("button");
  useBtn.className = "btn btn-sm btn-primary";
  useBtn.textContent = "Usar esta resposta";
  useBtn.addEventListener("click", () => useResponse(index));

  actions.appendChild(copyBtn);
  actions.appendChild(useBtn);

  footer.appendChild(stopBtn);
  footer.appendChild(stats);
  footer.appendChild(actions);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);

  return panel;
}

function populateModelSelect(select) {
  // Pull-based via callback registrado em initComparison. Caller (app.js)
  // entrega runtime.models — desacopla comparison.js do estado global.
  const models = getModels();
  const conn = store.get("connection");

  if (models.length > 0 && modelToServerId.size === 0) {
    models.forEach(m => modelToServerId.set(m, conn.activeServerId));
  }

  const groups = groupModelsByServer(models, conn.servers, modelToServerId);

  select.innerHTML = '<option value="">Selecione um modelo...</option>';

  groups.forEach(g => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = g.serverNickname;
    g.models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
}

function buildComposer() {
  const composer = document.createElement("div");
  composer.className = "comparison-composer";

  const textarea = document.createElement("textarea");
  textarea.id = "comparisonInput";
  textarea.placeholder = "Digite o prompt para comparar...";
  textarea.rows = 3;
  
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  });

  const bar = document.createElement("div");
  bar.className = "comparison-composer-bar row";
  bar.style.justifyContent = "flex-end";
  bar.style.marginTop = "var(--s-2)";

  const sendBtn = document.createElement("button");
  sendBtn.id = "comparisonSend";
  sendBtn.className = "btn btn-primary";
  sendBtn.textContent = "Enviar para ambos";
  sendBtn.addEventListener("click", handleSend);

  bar.appendChild(sendBtn);
  composer.appendChild(textarea);
  composer.appendChild(bar);

  return composer;
}

async function handleSend() {
  const input = elements.comparisonView.querySelector("#comparisonInput");
  const prompt = input.value.trim();
  if (!prompt) return;

  if (sessionState.busyA || sessionState.busyB) return;

  sessionState.prompt = prompt;
  sessionState.responseA = "";
  sessionState.responseB = "";
  sessionState.reasoningA = "";
  sessionState.reasoningB = "";

  // Valida modelos
  if (!sessionState.modelA && !sessionState.modelB) {
    toast("Selecione ao menos um modelo.", "warn");
    return;
  }

  // Prepara UI
  input.value = "";
  input.disabled = true;
  elements.comparisonView.querySelector("#comparisonSend").disabled = true;

  const panels = elements.comparisonView.querySelectorAll(".comparison-panel");
  panels.forEach((p, i) => {
    const msgArea = p.querySelector(".panel-messages");
    msgArea.replaceChildren();
    
    const stats = p.querySelector(".panel-stats");
    stats.replaceChildren();
    
    const actions = p.querySelector(".panel-actions");
    actions.classList.add("hidden");

    const select = p.querySelector(".model-select");
    const label = p.querySelector(".panel-model-label");
    
    if ((i === 0 && !sessionState.modelA) || (i === 1 && !sessionState.modelB)) {
      msgArea.innerHTML = '<p class="field-help" style="color:var(--warn)">Nenhum modelo selecionado.</p>';
      return;
    }

    select.classList.add("hidden");
    label.textContent = i === 0 ? sessionState.modelA : sessionState.modelB;
    label.classList.remove("hidden");
    
    p.querySelector(".panel-stop").classList.remove("hidden");
  });

  // Dispara paralelo
  const promises = [];
  if (sessionState.modelA) promises.push(startGeneration(0));
  if (sessionState.modelB) promises.push(startGeneration(1));

  await Promise.all(promises);

  // Finaliza UI global
  input.disabled = false;
  elements.comparisonView.querySelector("#comparisonSend").disabled = false;
  requestAnimationFrame(() => input.focus());
}

async function startGeneration(index) {
  const modelId = index === 0 ? sessionState.modelA : sessionState.modelB;
  const panel = elements.comparisonView.querySelector(`.comparison-panel[data-panel="${index}"]`);
  const body = panel.querySelector(".panel-messages");
  
  if (index === 0) sessionState.busyA = true;
  else sessionState.busyB = true;

  // Adiciona feedback visual de processamento
  panel.classList.add("generating");

  const conn = store.get("connection");
  const server = resolveServerForModel(modelId, conn.servers, modelToServerId);
  if (!server) {
    finalizePanel(index, "Servidor não encontrado.", true);
    return;
  }

  const profile = store.get("profiles").find(p => p.id === store.get("activeProfileId"));
  const sampling = buildSamplingPayload(profile.sampling);
  
  const { payloadA, payloadB } = buildComparisonPayloads({
    prompt: sessionState.prompt,
    modelA: sessionState.modelA,
    modelB: sessionState.modelB,
    profile,
    samplingOverride: sampling
  });

  const payload = index === 0 ? payloadA : payloadB;
  const controller = new AbortController();
  sessionState.streamControllers[index] = controller;
  
  const timer = startGenerationTimer(body);
  sessionState.timers[index] = timer;

  try {
    const baseUrl = normalizeBaseUrl(server.baseUrl);
    const result = await requestCompletion({
      baseUrl,
      apiKey: server.apiKey,
      payload,
      signal: controller.signal,
    }, (delta, full) => {
      if (index === 0) {
        sessionState.responseA = full.content;
        sessionState.reasoningA = full.reasoning;
      } else {
        sessionState.responseB = full.content;
        sessionState.reasoningB = full.reasoning;
      }
      appendStreamingDelta(body, full.content, full.reasoning);
      if (full.usage?.completion_tokens) timer.setTokenCount(full.usage.completion_tokens);
    });

    finalizePanel(index, result.content, false, result.reasoning, {
      usage: result.usage,
      finishReason: result.finishReason,
      elapsed: timer.getElapsed(),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      finalizePanel(index, (index === 0 ? sessionState.responseA : sessionState.responseB) + "\n\n[Geração interrompida pelo usuário]", false, (index === 0 ? sessionState.reasoningA : sessionState.reasoningB));
    } else {
      finalizePanel(index, `Erro: ${err.message}`, true);
    }
  } finally {
    if (index === 0) sessionState.busyA = false;
    else sessionState.busyB = false;
    sessionState.streamControllers[index] = null;
    stopGenerationTimer(timer);
    // Remove feedback visual de processamento
    panel.classList.remove("generating");
  }
}

function abortPanel(index) {
  sessionState.streamControllers[index]?.abort();
}

function finalizePanel(index, content, isError, reasoning, meta) {
  const panel = elements.comparisonView.querySelector(`.comparison-panel[data-panel="${index}"]`);
  const body = panel.querySelector(".panel-messages");
  
  finalizeAssistant(body, content, isError, reasoning, meta);
  
  panel.querySelector(".panel-stop").classList.add("hidden");
  panel.querySelector(".panel-actions").classList.remove("hidden");
  
  // Stats
  if (meta) {
    const statsEl = panel.querySelector(".panel-stats");
    const u = meta.usage || {};
    const parts = [];
    if (u.completion_tokens) parts.push(`${u.completion_tokens} tokens`);
    if (meta.elapsed) parts.push(`${(meta.elapsed / 1000).toFixed(1)}s`);
    if (u.completion_tokens && meta.elapsed) {
      parts.push(`${(u.completion_tokens / (meta.elapsed / 1000)).toFixed(1)} tok/s`);
    }
    statsEl.textContent = parts.join(" · ");
  }

  // Volta o select se não for erro crítico
  const select = panel.querySelector(".model-select");
  const label = panel.querySelector(".panel-model-label");
  select.classList.remove("hidden");
  label.classList.add("hidden");
}

async function useResponse(index) {
  const content = index === 0 ? sessionState.responseA : sessionState.responseB;
  const model = index === 0 ? sessionState.modelA : sessionState.modelB;
  const conn = store.get("connection");
  const server = resolveServerForModel(model, conn.servers, modelToServerId);
  
  const conversation = buildConversationFromComparison({
    prompt: sessionState.prompt,
    response: content,
    model,
    profileId: store.get("activeProfileId"),
    serverId: server?.id || conn.activeServerId
  });

  await onUseResponse(conversation);
  closeComparison(true);
}
