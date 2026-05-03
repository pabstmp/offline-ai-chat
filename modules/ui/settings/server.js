import { toast } from "../toasts.js";
import { state, section, field, input, button } from "./_shared.js";

export function panelServer() {
  const { store, elements, onChange, onConnect, onLoadModels, rebuildPanel } = state;
  const conn = store.get("connection");
  const sec = section("Servidores");

  for (const server of conn.servers) {
    const isActive = conn.activeServerId === server.id;
    const c = document.createElement("div");
    c.className = "drawer-card" + (isActive ? " active-card" : "");

    const head = document.createElement("div");
    head.className = "row";
    const radio = input({ type: "radio", name: "active-server", checked: isActive,
      onchange: () => { store.set("connection.activeServerId", server.id); onChange(); rebuildPanel("server"); }
    });
    const nick = input({
      type: "text", value: server.nickname,
      style: "flex: 1; font-weight: 600;",
      onchange: (e) => { server.nickname = e.target.value; onChange(); },
    });
    head.appendChild(radio);
    head.appendChild(nick);
    if (conn.servers.length > 1) {
      head.appendChild(button("Excluir", "btn-danger", () => {
        if (!confirm(`Excluir "${server.nickname}"?`)) return;
        const newList = conn.servers.filter((s) => s.id !== server.id);
        store.set("connection.servers", newList);
        if (isActive) store.set("connection.activeServerId", newList[0].id);
        onChange();
        rebuildPanel("server");
      }));
    }
    c.appendChild(head);

    c.appendChild(field("URL", input({
      type: "text", value: server.baseUrl, placeholder: "http://localhost:1234/v1",
      onchange: (e) => { server.baseUrl = e.target.value.trim(); onChange(); },
    }), "IP, host ou URL completa. Sem caminho, usa /v1."));

    const apiKeyForm = document.createElement("form");
    apiKeyForm.setAttribute("autocomplete", "off");
    apiKeyForm.addEventListener("submit", (e) => e.preventDefault());
    apiKeyForm.appendChild(field("API key (opcional)", input({
      type: "password", value: server.apiKey || "", placeholder: "vazio no LM Studio",
      autocomplete: "off",
      onchange: (e) => { server.apiKey = e.target.value; onChange(); },
    })));
    c.appendChild(apiKeyForm);

    const row = document.createElement("div");
    row.className = "row cols2";
    row.appendChild(field("Timeout (ms)", input({
      type: "number", value: server.timeoutMs || 60000, min: "1000", step: "1000",
      onchange: (e) => { server.timeoutMs = Number(e.target.value); onChange(); },
    })));
    row.appendChild(field("Retry count", input({
      type: "number", value: server.retry?.count || 0, min: "0", max: "10",
      onchange: (e) => {
        if (!server.retry) server.retry = { count: 0, backoffMs: 1000 };
        server.retry.count = Number(e.target.value);
        onChange();
      },
    })));
    c.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "row";
    actions.appendChild(button("Testar conexão", "btn-secondary", async () => {
      const start = performance.now();
      try {
        const models = await onLoadModels(server);
        const ms = Math.round(performance.now() - start);
        toast(`OK · ${models.length} modelo(s) · ${ms}ms`, "success");
      } catch (err) { toast(err.message, "error"); }
    }));
    actions.appendChild(button(isActive ? "Reconectar" : "Ativar e conectar", "btn-primary", () => {
      store.set("connection.activeServerId", server.id);
      onConnect();
      rebuildPanel("server");
    }));
    c.appendChild(actions);

    sec.appendChild(c);
  }

  sec.appendChild(button("+ Adicionar servidor", "btn-secondary", () => {
    const id = `server-${Date.now()}`;
    store.set("connection.servers", [...conn.servers, {
      id, nickname: "Novo servidor", baseUrl: "", apiKey: "",
      headers: {}, timeoutMs: 60000, retry: { count: 0, backoffMs: 1000 },
    }]);
    onChange();
    rebuildPanel("server");
  }));

  elements.settingsBody.appendChild(sec);

  const modelsSec = section("Modelos no servidor LM Studio");
  const modelsHelp = document.createElement("p");
  modelsHelp.className = "field-help";
  modelsHelp.textContent =
    "Visualize quais modelos estão carregados, com qual context length, e recarregue com configuração maior. " +
    "Útil quando o LM Studio carrega o modelo com ctx pequeno por padrão.";
  modelsSec.appendChild(modelsHelp);

  const modelsContainer = document.createElement("div");
  modelsContainer.dataset.role = "lm-models";
  modelsContainer.style.display = "flex";
  modelsContainer.style.flexDirection = "column";
  modelsContainer.style.gap = "var(--s-2)";
  const loading = document.createElement("p");
  loading.className = "field-help";
  loading.textContent = "Carregando modelos do servidor...";
  modelsContainer.appendChild(loading);
  modelsSec.appendChild(modelsContainer);

  const refreshBtn = button("↻ Atualizar lista", "btn-ghost", () => populateLmModels(modelsContainer));
  modelsSec.appendChild(refreshBtn);

  populateLmModels(modelsContainer);

  elements.settingsBody.appendChild(modelsSec);
}

async function populateLmModels(container) {
  container.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "field-help";
  loading.textContent = "Carregando...";
  container.appendChild(loading);

  const conn = state.store.get("connection");
  const server = conn.servers.find((s) => s.id === conn.activeServerId) || conn.servers[0];
  if (!server?.baseUrl) {
    loading.textContent = "Nenhum servidor ativo.";
    return;
  }

  try {
    const { lmListModelsInfo } = await import("../../api.js");
    const models = await lmListModelsInfo({ baseUrl: server.baseUrl, apiKey: server.apiKey });
    container.replaceChildren();
    if (!models.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "Nenhum modelo disponível no servidor.";
      container.appendChild(empty);
      return;
    }
    for (const m of models) {
      container.appendChild(buildLmModelCard(m, server, container));
    }
  } catch (err) {
    container.replaceChildren();
    const errBox = document.createElement("p");
    errBox.className = "field-help";
    errBox.style.color = "var(--warn)";
    errBox.textContent = `Não foi possível listar modelos extendidos: ${err.message}. Esse recurso requer LM Studio 0.3+ com REST API.`;
    container.appendChild(errBox);
  }
}

function buildLmModelCard(model, server, container) {
  const c = document.createElement("div");
  c.className = "drawer-card";

  const head = document.createElement("div");
  head.className = "row";
  head.style.gap = "var(--s-2)";

  const stateBadge = document.createElement("span");
  stateBadge.style.padding = "2px 8px";
  stateBadge.style.borderRadius = "var(--r-sm)";
  stateBadge.style.fontSize = "var(--fs-xs)";
  stateBadge.style.fontWeight = "600";
  if (model.state === "loaded") {
    stateBadge.style.background = "rgba(74, 222, 128, 0.18)";
    stateBadge.style.color = "var(--success)";
    stateBadge.textContent = "● carregado";
  } else {
    stateBadge.style.background = "var(--bg-2)";
    stateBadge.style.color = "var(--fg-2)";
    stateBadge.textContent = "○ não carregado";
  }
  head.appendChild(stateBadge);

  const type = document.createElement("span");
  type.style.padding = "2px 8px";
  type.style.borderRadius = "var(--r-sm)";
  type.style.background = "var(--bg-2)";
  type.style.fontSize = "var(--fs-xs)";
  type.style.fontFamily = "var(--font-mono)";
  type.textContent = model.type || "?";
  head.appendChild(type);

  const name = document.createElement("strong");
  name.style.flex = "1";
  name.style.fontFamily = "var(--font-mono)";
  name.style.fontSize = "var(--fs-sm)";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  name.style.whiteSpace = "nowrap";
  name.textContent = model.id;
  head.appendChild(name);
  c.appendChild(head);

  const ctxInfo = document.createElement("p");
  ctxInfo.className = "field-help";
  ctxInfo.style.margin = "0";
  ctxInfo.style.fontFamily = "var(--font-mono)";
  ctxInfo.style.fontSize = "var(--fs-xs)";
  const max = model.max_context_length;
  const loaded = model.loaded_context_length;
  if (model.state === "loaded") {
    const pct = max ? Math.round((loaded / max) * 100) : 0;
    let color = "var(--fg-2)";
    if (max && loaded < max * 0.1) color = "var(--warn)";
    if (max && loaded < max * 0.05) color = "var(--danger)";
    ctxInfo.style.color = color;
    ctxInfo.textContent = `ctx atual: ${loaded?.toLocaleString() || "?"} / max: ${max?.toLocaleString() || "?"} tokens (${pct}%) · arch: ${model.arch || "?"}`;
  } else {
    ctxInfo.textContent = `max suportado: ${max?.toLocaleString() || "?"} tokens · arch: ${model.arch || "?"}`;
  }
  c.appendChild(ctxInfo);

  const actions = document.createElement("div");
  actions.className = "row";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "var(--s-1)";

  const presets = [4096, 8192, 16384, 32768];
  for (const ctxValue of presets) {
    if (max && ctxValue > max) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm " + (loaded === ctxValue ? "btn-primary" : "btn-secondary");
    btn.textContent = ctxValue >= 1024 ? `${ctxValue / 1024}k` : String(ctxValue);
    btn.title = `Carregar ${model.id} com context_length=${ctxValue}`;
    btn.addEventListener("click", () => loadWithCtx(model.id, ctxValue, server, container));
    actions.appendChild(btn);
  }

  const customBtn = document.createElement("button");
  customBtn.type = "button";
  customBtn.className = "btn btn-ghost btn-sm";
  customBtn.textContent = "Custom...";
  customBtn.addEventListener("click", () => {
    const v = prompt(`Context length custom para ${model.id} (max: ${max || "?"})`);
    const n = Number(v);
    if (!n || n < 256) return;
    if (max && n > max) {
      toast(`Excede o máximo do modelo (${max}).`, "warn");
      return;
    }
    loadWithCtx(model.id, n, server, container);
  });
  actions.appendChild(customBtn);

  if (model.state === "loaded") {
    const unloadBtn = document.createElement("button");
    unloadBtn.type = "button";
    unloadBtn.className = "btn btn-danger btn-sm";
    unloadBtn.textContent = "Descarregar";
    unloadBtn.addEventListener("click", async () => {
      try {
        const { lmUnloadModel } = await import("../../api.js");
        await lmUnloadModel({ baseUrl: server.baseUrl, apiKey: server.apiKey, model: model.id });
        toast(`${model.id} descarregado.`, "info");
        populateLmModels(container);
      } catch (err) {
        toast(`Erro: ${err.message}`, "error");
      }
    });
    actions.appendChild(unloadBtn);
  }

  c.appendChild(actions);
  return c;
}

async function loadWithCtx(modelId, contextLength, server, container) {
  const { lmLoadModel } = await import("../../api.js");
  const original = container.querySelectorAll("button");
  original.forEach((b) => { b.disabled = true; });
  toast(`Carregando ${modelId} com ctx=${contextLength}... (~5s)`, "info");
  try {
    await lmLoadModel({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      model: modelId,
      contextLength,
    });
    toast(`${modelId} carregado com ${contextLength.toLocaleString()} tokens de contexto!`, "success");
    populateLmModels(container);
  } catch (err) {
    toast(`Erro ao carregar: ${err.message}`, "error", 6000);
    original.forEach((b) => { b.disabled = false; });
  }
}
