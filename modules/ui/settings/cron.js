/* Settings → aba "Tarefas" (tarefas agendadas / cron).
 *
 * Diferente das outras abas, NÃO usa store.set: tarefas e conexões vivem no
 * servidor (cron-state.json) e são editadas via /api/cron/*. Este painel é um
 * editor remoto desse estado. Prefs locais (notificação) ficam em store("cron").
 *
 * Padrão de re-render: qualquer mutação chama rerender(), que re-busca o estado
 * do servidor e reconstrói a aba — mantém UI e servidor sempre coerentes. */

import {
  state, section, field, input, select, checkbox, button, card,
} from "./_shared.js";
import {
  cronList, cronUpsertTask, cronDeleteTask, cronRunNow, cronResult,
  cronUpsertConnection, cronDeleteConnection, cronUpsertAgent, cronDeleteAgent,
  listModels, lmListModelsInfo,
} from "../../api.js";
import { renderMarkdown } from "../../markdown.js";

let cache = null;          // última resposta de /api/cron/list
let editingTaskId = null;  // "new" | id | null
let newTaskType = "web_search_digest";
let editingConnId = null;  // "new" | id | null
let editingAgentId = null; // "new" | id | null
let setupOpen = null;      // estado do bloco "Conexões e agentes" (null = automático)
let hostEl = null;         // container atual (pra re-render in-place sem perder editingId)

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function panelCron() {
  // Entrada da aba: começa limpo (sem editor aberto).
  editingTaskId = null;
  editingConnId = null;
  editingAgentId = null;
  const sec = section("Tarefas Agendadas");
  hostEl = document.createElement("div");
  hostEl.textContent = "Carregando…";
  sec.appendChild(hostEl);
  state.elements.settingsBody.appendChild(sec);
  load(hostEl);
}

async function load(host) {
  try {
    cache = await cronList();
  } catch (e) {
    host.replaceChildren(errorCard(`Falha ao carregar tarefas: ${e.message}`));
    return;
  }
  render(host);
}

/* Re-busca e re-renderiza NO MESMO host, preservando o estado de edição
   (editingTaskId/editingConnId). Importante: NÃO passa por panelCron, que
   zeraria os flags de edição. */
function rerender() {
  if (hostEl && hostEl.isConnected) load(hostEl);
  else state.rebuildPanel("cron");
}

function render(host) {
  host.replaceChildren();
  host.appendChild(statusBanner(cache));
  if (!cache.enabled) {
    // Mesmo desabilitado o usuário pode configurar; só não dispara.
    host.appendChild(disabledHelp());
  }
  // Tarefas em destaque no topo.
  host.appendChild(tasksSection(cache));
  // Setup (conexões + agentes) recolhido — aberto só quando falta configurar
  // ou quando um editor de conexão/agente está aberto.
  const nConn = (cache.connections || []).filter((x) => !x.sourceServerId).length;
  const nAgent = (cache.agents || []).filter((a) => !a.sourceProfileId).length;
  const autoOpen = nConn === 0 || editingConnId != null || editingAgentId != null;
  const setup = collapsible("Conexões e agentes", {
    open: setupOpen != null ? setupOpen : autoOpen,
    suffix: `${nConn} ${nConn === 1 ? "conexão" : "conexões"} · ${nAgent} ${nAgent === 1 ? "agente" : "agentes"}`,
  });
  setup.el.addEventListener("toggle", () => { setupOpen = setup.el.open; });
  setup.body.appendChild(connectionsSection(cache));
  setup.body.appendChild(agentsSection(cache));
  host.appendChild(setup.el);
}

/* ---------- helpers de UI ---------- */

function help(text) {
  const p = document.createElement("p");
  p.className = "field-help";
  p.textContent = text;
  return p;
}

function errorCard(msg) {
  const c = card(help(msg));
  c.style.borderColor = "var(--danger, #c0392b)";
  return c;
}

function textarea(value, rows, placeholder) {
  const t = document.createElement("textarea");
  t.value = value || "";
  t.rows = rows || 4;
  if (placeholder) t.placeholder = placeholder;
  t.style.width = "100%";
  return t;
}

function badge(text, kind) {
  const s = document.createElement("span");
  s.className = "pill";
  s.textContent = text;
  const colors = { ok: "#2e7d32", error: "#c0392b", timeout: "#c0392b", running: "#1565c0", null: "#777" };
  s.style.background = colors[kind] || "#777";
  s.style.color = "#fff";
  s.style.padding = "1px 8px";
  s.style.borderRadius = "10px";
  s.style.fontSize = "11px";
  return s;
}

function fmtTime(ms) {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

function scheduleHuman(schedule) {
  if (!schedule) return "—";
  const tz = schedule.tz ? ` (${schedule.tz})` : "";
  if (schedule.kind === "preset" && schedule.preset) {
    const p = schedule.preset;
    if (p.kind === "hourly") return `Toda hora no minuto ${p.minute || 0}${tz}`;
    if (p.kind === "daily") return `Diariamente às ${p.time || "08:00"}${tz}`;
    if (p.kind === "weekly") return `${WEEKDAYS[p.weekday] || "Seg"} às ${p.time || "08:00"}${tz}`;
  }
  return `cron: ${schedule.cron || "?"}${tz}`;
}

/* Bloco colapsável reutilizando o estilo `advanced-settings-details` (chevron animado).
   suffix aparece em texto-mudo no cabeçalho, pra informar mesmo recolhido. */
function collapsible(title, { open = false, suffix = "" } = {}) {
  const det = document.createElement("details");
  det.className = "advanced-settings-details";
  if (open) det.open = true;
  const sum = document.createElement("summary");
  const t = document.createElement("span");
  t.textContent = title;
  sum.appendChild(t);
  if (suffix) {
    const s = document.createElement("span");
    s.className = "field-help";
    s.style.cssText = "margin:0 10px 0 auto;";
    s.textContent = suffix;
    sum.appendChild(s);
  }
  det.appendChild(sum);
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:var(--s-3);";
  det.appendChild(body);
  return { el: det, body };
}

/* Controle segmentado (ex.: Standard | Avançado). Retorna { el, get }. */
function segmented(options, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "segmented";
  let cur = value;
  const btns = [];
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o.label;
    if (o.value === cur) b.classList.add("active");
    b.addEventListener("click", () => {
      if (cur === o.value) return;
      cur = o.value;
      btns.forEach((x) => x.classList.toggle("active", x === b));
      onChange(cur);
    });
    btns.push(b);
    wrap.appendChild(b);
  }
  return { el: wrap, get: () => cur };
}

/* ---------- banner / status ---------- */

function statusBanner(c) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.marginBottom = "var(--s-3)";
  row.appendChild(badge(c.enabled ? "Motor ativo" : "Motor desligado", c.enabled ? "ok" : "null"));
  return row;
}

function disabledHelp() {
  const c = card([]);
  c.appendChild(help(
    "O motor está desligado (CRON_ENABLED não está ativo). Você pode configurar tudo aqui, " +
    "mas nada dispara até habilitar no servidor. No docker-compose.yml:"
  ));
  const pre = document.createElement("pre");
  pre.style.cssText = "background:var(--bg-elev,#1c1c1c);padding:10px;border-radius:8px;overflow:auto;font-size:12px;";
  pre.textContent = [
    "environment:",
    '  CRON_ENABLED: "true"',
    "  FS_WRITE_ROOTS: /app/data/output",
    "  CRON_STATE_DIR: /app/data",
    "  CRON_TZ: America/Sao_Paulo",
  ].join("\n");
  c.appendChild(pre);
  return c;
}

/* ---------- conexões ---------- */

function connectionsSection(c) {
  const sec = section("Conexões LLM");
  // Conexões espelhadas de um perfil/servidor (sourceServerId) são auto-gerenciadas — escondidas aqui.
  for (const conn of (c.connections || []).filter((x) => !x.sourceServerId)) {
    sec.appendChild(editingConnId === conn.id ? connectionEditor(conn, c) : connectionCard(conn));
  }
  if (editingConnId === "new") sec.appendChild(connectionEditor(null, c));
  if (editingConnId !== "new") {
    const actions = document.createElement("div");
    actions.className = "row";
    actions.appendChild(button("+ Nova conexão", "btn-secondary", () => { editingConnId = "new"; setupOpen = true; rerender(); }));
    actions.appendChild(button("Copiar do servidor de chat", "btn-ghost", copyFromChatServer));
    sec.appendChild(actions);
  }
  return sec;
}

/* Linha compacta reutilizável pra conexões/agentes: título + subtítulo + Editar/×. */
function listRow(title, subtitle, onEdit, onDelete) {
  const c = card([]);
  const row = document.createElement("div");
  row.className = "cron-list-row";
  const info = document.createElement("div");
  info.className = "grow";
  const name = document.createElement("strong");
  name.textContent = title;
  info.appendChild(name);
  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "cron-list-sub";
    sub.textContent = subtitle;
    info.appendChild(sub);
  }
  row.appendChild(info);
  row.appendChild(button("Editar", "btn-ghost btn-sm", onEdit));
  row.appendChild(button("×", "btn-ghost btn-sm", onDelete));
  c.appendChild(row);
  return c;
}

function connectionCard(conn) {
  return listRow(
    conn.nickname || conn.baseUrl,
    `${conn.baseUrl} · ${conn.model || "modelo padrão"}`,
    () => { editingConnId = conn.id; setupOpen = true; rerender(); },
    async () => { try { await cronDeleteConnection(conn.id); rerender(); } catch (e) { state.toast(e.message, "error"); } }
  );
}

/* Campo de modelo: input livre + botão "buscar modelos" que consulta o servidor
   (getBaseUrl/getApiKey) e abre um select com os DISPONÍVEIS, separando os
   CARREGADOS (state==="loaded" no LM Studio). Escrever na mão também vale. */
function modelField(label, modelInput, getBaseUrl, getApiKey) {
  const pick = document.createElement("div");
  const fetchBtn = button("🔄 buscar modelos", "btn-ghost btn-sm", async () => {
    const url = (getBaseUrl() || "").trim();
    if (!url) { state.toast("Preencha a Base URL primeiro.", "warn"); return; }
    const key = getApiKey() || "";
    fetchBtn.disabled = true; const orig = fetchBtn.textContent; fetchBtn.textContent = "buscando…";
    try {
      let opts = [];
      // 1) LM Studio estendido (sabe quais estão carregados)
      try {
        const info = await lmListModelsInfo({ baseUrl: url, apiKey: key });
        opts = (info || []).map((m) => ({ id: m.id, loaded: m.state === "loaded" }));
      } catch (_) { /* não é LM Studio — cai no genérico */ }
      // 2) genérico (/v1/models) — OpenRouter, etc.
      if (!opts.length) {
        const list = await listModels({ baseUrl: url, apiKey: key });
        opts = list.map((m) => ({ id: m.id, loaded: false }));
      }
      if (!opts.length) { state.toast("Nenhum modelo retornado pelo servidor.", "warn"); return; }
      const sel = document.createElement("select");
      sel.appendChild(new Option("— escolher modelo —", ""));
      const loaded = opts.filter((o) => o.loaded);
      const others = opts.filter((o) => !o.loaded);
      const addGroup = (lbl, arr) => {
        if (!arr.length) return;
        const g = document.createElement("optgroup"); g.label = lbl;
        arr.forEach((o) => g.appendChild(new Option(o.id, o.id)));
        sel.appendChild(g);
      };
      addGroup("● Carregados", loaded);
      addGroup("Disponíveis", others);
      if (modelInput.value && opts.some((o) => o.id === modelInput.value)) sel.value = modelInput.value;
      sel.addEventListener("change", () => { if (sel.value) modelInput.value = sel.value; });
      pick.replaceChildren(sel);
      state.toast(`${opts.length} modelo(s)${loaded.length ? ` · ${loaded.length} carregado(s)` : ""}.`, "success");
    } catch (e) {
      state.toast("Falha ao buscar modelos: " + e.message, "error");
    } finally {
      fetchBtn.disabled = false; fetchBtn.textContent = orig;
    }
  });
  const row = document.createElement("div");
  row.className = "row";
  const wrapIn = document.createElement("div"); wrapIn.className = "grow"; wrapIn.appendChild(modelInput);
  row.appendChild(wrapIn); row.appendChild(fetchBtn);
  const f = field(label, row, "Digite, ou clique em “buscar modelos” pra escolher (os carregados aparecem primeiro).");
  f.appendChild(pick);
  return f;
}

// Servidores de chat salvos (localStorage) — pra reaproveitar sem redigitar.
function savedChatServers() {
  const conn = state.store.get("connection") || {};
  return Array.isArray(conn.servers) ? conn.servers : [];
}
function activeChatModel() {
  const profiles = state.store.get("profiles") || [];
  const ap = profiles.find((p) => p.id === state.store.get("activeProfileId")) || profiles[0];
  return (ap && ap.defaultModel) || "";
}

/* ---------- ponte perfil de chat → agente/conexão do cron ---------- */

function chatProfiles() {
  return state.store.get("profiles") || [];
}
function serverOfProfile(p) {
  const conn = state.store.get("connection") || {};
  const servers = conn.servers || [];
  return servers.find((s) => s.id === p.defaultServerId) ||
    servers.find((s) => s.id === conn.activeServerId) || servers[0] || null;
}

/* Provisiona (idempotente) a conexão + o agente do cron a partir de um perfil de
   chat. Reaproveita os espelhos existentes (sourceServerId/sourceProfileId) e os
   atualiza in-place em `cronState` pra deduplicar entre passos no mesmo Salvar.
   Retorna o agentId. */
async function ensureProfileProvisioned(profile, cronState) {
  const server = serverOfProfile(profile);
  if (!server) throw new Error(`Perfil "${profile.name}" não tem servidor — configure na aba Servidor.`);

  // 1) conexão (espelho do servidor)
  let conn = (cronState.connections || []).find((c) => c.sourceServerId === server.id);
  const connObj = (await cronUpsertConnection({
    id: conn ? conn.id : undefined,
    sourceServerId: server.id,
    nickname: server.nickname || "Servidor de chat",
    baseUrl: server.baseUrl,
    apiKey: server.apiKey || "",
    model: profile.defaultModel || "",
  })).connection;
  if (conn) Object.assign(conn, connObj); else { cronState.connections = cronState.connections || []; cronState.connections.push(connObj); }

  // 2) agente (espelho do perfil)
  let agent = (cronState.agents || []).find((a) => a.sourceProfileId === profile.id);
  const agObj = (await cronUpsertAgent({
    id: agent ? agent.id : undefined,
    sourceProfileId: profile.id,
    name: profile.name || "Agente",
    connectionId: connObj.id,
    model: profile.defaultModel || "",
    systemPrompt: profile.systemPrompt || "",
    defaultPrompt: agent ? agent.defaultPrompt : "",
    temperature: profile.sampling?.temperature ?? 0.3,
    tools: agent ? agent.tools : undefined,
    sampling: profile.sampling || null,
  })).agent;
  if (agent) Object.assign(agent, agObj); else { cronState.agents = cronState.agents || []; cronState.agents.push(agObj); }

  return agObj.id;
}

function connectionEditor(conn, c) {
  const editing = !!conn;
  const wrap = card([]);
  const nick = input({ type: "text", value: conn?.nickname || "", placeholder: "Apelido (ex: OpenRouter)" });
  const baseUrl = input({ type: "text", value: conn?.baseUrl || "", placeholder: "https://openrouter.ai/api/v1" });
  const model = input({ type: "text", value: conn?.model || "", placeholder: "google/gemini-2.5-flash:free" });
  const apiKey = input({ type: "password", value: "", placeholder: editing && conn.hasApiKey ? "*** (em branco mantém a atual)" : "API key (opcional)" });
  const apiKeyEnv = input({ type: "text", value: conn?.apiKeyEnv || "", placeholder: "ou nome de env var (ex: OPENROUTER_KEY)" });

  // Atalho: preencher a partir de um servidor de chat já salvo (aba Servidor).
  const servers = savedChatServers();
  if (servers.length) {
    const importSel = select(
      [{ value: "", label: "— escolher servidor salvo —" }, ...servers.map((s) => ({ value: s.id, label: s.nickname || s.baseUrl }))],
      ""
    );
    importSel.addEventListener("change", () => {
      const s = servers.find((x) => x.id === importSel.value);
      importSel.value = "";
      if (!s) return;
      if (!nick.value) nick.value = s.nickname || "LM Studio";
      baseUrl.value = s.baseUrl || "";
      if (!model.value) model.value = activeChatModel();
      if (s.apiKey) apiKey.value = s.apiKey;
      state.toast("Campos preenchidos do servidor de chat — revise e salve.", "info");
    });
    wrap.appendChild(field("Importar de um servidor salvo", importSel, "Puxa URL, modelo e chave do que você já configurou na aba Servidor."));
  }

  wrap.appendChild(field("Apelido", nick));
  wrap.appendChild(field("Base URL", baseUrl, "Mesma política SSRF do proxy (ALLOWED_LM_HOSTS em LAN)."));
  wrap.appendChild(modelField("Modelo padrão", model, () => baseUrl.value, () => apiKey.value));
  wrap.appendChild(field("API key", apiKey));
  wrap.appendChild(field("API key via env (alternativa segura)", apiKeyEnv, "Se preenchido, a chave literal é ignorada; o servidor lê process.env[NOME]."));

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("Salvar", "btn-primary", async () => {
    const payload = {
      id: editing ? conn.id : undefined,
      nickname: nick.value, baseUrl: baseUrl.value, model: model.value,
      apiKeyEnv: apiKeyEnv.value.trim() || null,
    };
    // chave: em branco editando conexão existente com chave → mantém ("***")
    if (apiKey.value) payload.apiKey = apiKey.value;
    else payload.apiKey = editing && conn.hasApiKey ? "***" : "";
    try {
      await cronUpsertConnection(payload);
      editingConnId = null;
      state.toast("Conexão salva.", "success");
      rerender();
    } catch (e) { state.toast(e.message, "error"); }
  }));
  actions.appendChild(button("Cancelar", "btn-ghost", () => { editingConnId = null; rerender(); }));
  wrap.appendChild(actions);
  return wrap;
}

async function copyFromChatServer() {
  const conn = state.store.get("connection");
  const srv = (conn.servers || []).find((s) => s.id === conn.activeServerId) || (conn.servers || [])[0];
  if (!srv) { state.toast("Nenhum servidor de chat configurado.", "warn"); return; }
  try {
    await cronUpsertConnection({
      nickname: srv.nickname || "Servidor de chat",
      baseUrl: srv.baseUrl, apiKey: srv.apiKey || "", model: activeChatModel(),
    });
    state.toast("Conexão copiada do servidor de chat.", "success");
    rerender();
  } catch (e) { state.toast(e.message, "error"); }
}

/* ---------- agentes reutilizáveis (skills) ---------- */

function agentsSection(c) {
  const sec = section("Agentes reutilizáveis");
  // Agentes espelhados de um perfil (sourceProfileId) são auto-gerenciados — escondidos aqui.
  for (const agent of (c.agents || []).filter((a) => !a.sourceProfileId)) {
    sec.appendChild(editingAgentId === agent.id ? agentEditor(agent, c) : agentCard(agent, c));
  }
  if (editingAgentId === "new") sec.appendChild(agentEditor(null, c));
  if (editingAgentId !== "new") {
    const actions = document.createElement("div");
    actions.className = "row";
    actions.appendChild(button("+ Novo agente", "btn-secondary", () => { editingAgentId = "new"; setupOpen = true; rerender(); }));
    sec.appendChild(actions);
  }
  return sec;
}

function agentCard(agent, c) {
  const conn = (c.connections || []).find((x) => x.id === agent.connectionId);
  const tools = [];
  if (agent.tools?.webSearch?.enabled) tools.push("busca web");
  if (agent.tools?.fileRead?.enabled) tools.push("lê arquivo");
  const sub = `${conn ? (conn.nickname || conn.baseUrl) : "sem conexão"} · ${agent.model || "modelo padrão"}` +
    (tools.length ? ` · ${tools.join(", ")}` : "");
  return listRow(
    agent.name || "Agente",
    sub,
    () => { editingAgentId = agent.id; setupOpen = true; rerender(); },
    async () => { try { await cronDeleteAgent(agent.id); rerender(); } catch (e) { state.toast(e.message, "error"); } }
  );
}

function agentEditor(agent, c) {
  const editing = !!agent;
  const wrap = card([]);
  const name = input({ type: "text", value: agent?.name || "", placeholder: "Ex: Pesquisador de mercado" });
  const connSel = select((c.connections || []).map((x) => ({ value: x.id, label: x.nickname || x.baseUrl })), agent?.connectionId || "");
  const model = input({ type: "text", value: agent?.model || "", placeholder: "vazio = modelo padrão da conexão" });
  const sys = textarea(agent?.systemPrompt || "", 2, "persona — quem este agente é (ex: 'Você é um analista de mercado…')");
  const defPrompt = textarea(agent?.defaultPrompt || "", 3, "instrução padrão — o que ele faz (pode ser sobrescrita no fluxo)");
  const temp = input({ type: "number", min: 0, max: 2, step: 0.1, value: agent?.temperature ?? 0.3 });
  const wsEnabled = checkbox("Buscar na web antes de responder", agent?.tools?.webSearch?.enabled ?? false, () => {});
  const wsQuery = input({ type: "text", value: agent?.tools?.webSearch?.query || "", placeholder: "busca padrão (opcional)" });
  const frEnabled = checkbox("Ler um arquivo local antes de responder", agent?.tools?.fileRead?.enabled ?? false, () => {});
  const frRel = input({ type: "text", value: agent?.tools?.fileRead?.relPath || "", placeholder: "caminho/relativo.md (opcional)" });

  if (!(c.connections || []).length) wrap.appendChild(errorCard("Crie uma conexão LLM acima primeiro."));
  wrap.appendChild(field("Nome", name));
  wrap.appendChild(field("Conexão LLM", connSel));
  wrap.appendChild(modelField("Modelo", model, () => { const cc = (c.connections || []).find((x) => x.id === connSel.value); return cc ? cc.baseUrl : ""; }, () => ""));
  wrap.appendChild(field("Persona (prompt de sistema)", sys));
  wrap.appendChild(field("Instrução padrão", defPrompt));
  wrap.appendChild(field("Temperatura", temp));
  wrap.appendChild(wsEnabled);
  wrap.appendChild(field("Busca padrão", wsQuery));
  wrap.appendChild(frEnabled);
  wrap.appendChild(field("Arquivo padrão", frRel));

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("Salvar", "btn-primary", async () => {
    try {
      await cronUpsertAgent({
        id: editing ? agent.id : undefined,
        name: name.value, connectionId: connSel.value, model: model.value.trim(),
        systemPrompt: sys.value, defaultPrompt: defPrompt.value,
        temperature: Number(temp.value),
        tools: {
          webSearch: { enabled: wsEnabled.querySelector("input").checked, query: wsQuery.value.trim() },
          fileRead: { enabled: frEnabled.querySelector("input").checked, relPath: frRel.value.trim() },
        },
      });
      editingAgentId = null;
      state.toast("Agente salvo.", "success");
      rerender();
    } catch (e) { state.toast(e.message, "error"); }
  }));
  actions.appendChild(button("Cancelar", "btn-ghost", () => { editingAgentId = null; rerender(); }));
  wrap.appendChild(actions);
  return wrap;
}

/* ---------- tarefas ---------- */

function tasksSection(c) {
  const sec = section("Tarefas");
  for (const task of c.tasks) {
    sec.appendChild(editingTaskId === task.id ? taskEditor(task, c) : taskCard(task));
  }
  if (editingTaskId === "new") sec.appendChild(taskEditor(null, c));

  if (editingTaskId !== "new") {
    sec.appendChild(button("+ Nova tarefa", "btn-secondary", () => { editingTaskId = "new"; newTaskType = "web_search_digest"; rerender(); }));
  }
  return sec;
}

function taskCard(task) {
  const c = card([]);
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
  const left = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = task.name;
  left.appendChild(name);
  left.appendChild(document.createTextNode(" "));
  left.appendChild(badge(task.enabled ? "ativa" : "pausada", task.enabled ? "ok" : "null"));
  if (task.state?.lastStatus) {
    left.appendChild(document.createTextNode(" "));
    left.appendChild(badge(task.state.lastStatus, task.state.lastStatus));
  }
  head.appendChild(left);
  c.appendChild(head);

  const regType = (cache.registry.find((r) => r.type === task.type) || {}).label || task.type;
  c.appendChild(help(`${regType}  ·  ${scheduleHuman(task.schedule)}`));
  c.appendChild(help(`Próxima: ${fmtTime(task.state?.nextRunAt)}  ·  Última: ${fmtTime(task.state?.lastRunAt)}${task.state?.lastError ? "  ·  erro: " + task.state.lastError : ""}${task.state?.scheduleError ? "  ·  agenda inválida: " + task.state.scheduleError : ""}`));

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("Executar agora", "btn-secondary", async () => {
    try {
      const r = await cronRunNow(task.id);
      state.toast(r.started ? "Tarefa disparada — aguarde…" : `Não iniciada: ${r.reason || ""}`, r.started ? "info" : "warn");
      setTimeout(rerender, 2500);
    } catch (e) { state.toast(e.message, "error"); }
  }));
  if (task.type === "web_search_digest" || task.type === "agent_pipeline") {
    actions.appendChild(button("Ver resultado", "btn-ghost", () => openResult(task)));
  }
  actions.appendChild(button("Editar", "btn-ghost", () => { editingTaskId = task.id; rerender(); }));
  actions.appendChild(button("×", "btn-ghost", async () => {
    try { await cronDeleteTask(task.id); rerender(); }
    catch (e) { state.toast(e.message, "error"); }
  }));
  c.appendChild(actions);
  return c;
}

function taskEditor(task, c) {
  const editing = !!task;
  const type = editing ? task.type : newTaskType;
  const reg = c.registry.find((r) => r.type === type) || c.registry[0];
  const wrap = card([]);

  // Tipo (só ao criar): primeiro, pois troca o formulário.
  if (!editing) {
    const typeSel = select(c.registry.map((r) => ({ value: r.type, label: r.label })), type);
    typeSel.addEventListener("change", () => { newTaskType = typeSel.value; rerender(); });
    wrap.appendChild(field("Tipo", typeSel));
  }

  // Header: nome (cresce) + toggle Ativa na mesma linha.
  const name = input({ type: "text", value: task?.name || reg.label, placeholder: "Nome da tarefa" });
  name.style.width = "100%";
  const enabled = checkbox("Ativa", task?.enabled ?? false, () => {});
  const header = document.createElement("div");
  header.className = "row";
  const nameWrap = document.createElement("div");
  nameWrap.className = "grow";
  nameWrap.appendChild(name);
  header.appendChild(nameWrap);
  header.appendChild(enabled);
  wrap.appendChild(header);

  // Passos / opções da tarefa (primário).
  const opts = optionsForm(type, task?.options || reg.defaultOptions, c);
  wrap.appendChild(opts.el);

  // Agendamento (recolhido, mostra o resumo no cabeçalho).
  const sched = schedulePicker(task?.schedule);
  const schedBlock = collapsible("Agendamento", { suffix: scheduleHuman(task?.schedule) });
  schedBlock.body.appendChild(sched.el);
  wrap.appendChild(schedBlock.el);

  // Política de execução (avançado, recolhido).
  const det = collapsible("Avançado · execução").el;
  const detBody = det.querySelector("div");
  const catchUp = checkbox("Executar no boot se perdeu o horário (catch-up)", task?.policy?.catchUpOnStart ?? false, () => {});
  const timeoutS = input({ type: "number", min: 1, value: Math.round((task?.policy?.timeoutMs || 120000) / 1000) });
  detBody.appendChild(catchUp);
  detBody.appendChild(field("Timeout (segundos)", timeoutS));
  wrap.appendChild(det);

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("Salvar", "btn-primary", async () => {
    const payload = {
      id: editing ? task.id : undefined,
      type,
      name: name.value,
      enabled: enabled.querySelector("input").checked,
      schedule: sched.read(),
      options: opts.read(),
      policy: {
        catchUpOnStart: catchUp.querySelector("input").checked,
        timeoutMs: Math.max(1, Number(timeoutS.value) || 120) * 1000,
      },
    };
    try {
      // Passos que referenciam um PERFIL de chat: provisiona (idempotente) a
      // conexão + o agente do cron a partir do perfil e troca profileId→agentId.
      if (type === "agent_pipeline") {
        const steps = (payload.options && payload.options.steps) || [];
        if (steps.some((s) => s.profileId)) {
          const cronState = await cronList();
          const profs = chatProfiles();
          for (const step of steps) {
            if (!step.profileId) continue;
            const prof = profs.find((p) => p.id === step.profileId);
            if (!prof) throw new Error("Perfil do passo não encontrado.");
            step.agentId = await ensureProfileProvisioned(prof, cronState);
          }
        }
      }
      await cronUpsertTask(payload);
      editingTaskId = null;
      state.toast("Tarefa salva.", "success");
      rerender();
    } catch (e) { state.toast(e.message, "error"); }
  }));
  actions.appendChild(button("Cancelar", "btn-ghost", () => { editingTaskId = null; rerender(); }));
  wrap.appendChild(actions);
  return wrap;
}

/* ---------- schedule picker ---------- */

function schedulePicker(schedule) {
  schedule = schedule || { kind: "preset", preset: { kind: "daily", time: "08:00", weekday: 1 }, tz: "" };
  const presetKind = schedule.kind === "preset" ? (schedule.preset?.kind || "daily") : "cron";
  const wrap = document.createElement("div");

  const modeSel = select([
    { value: "daily", label: "Diariamente" },
    { value: "weekly", label: "Semanalmente" },
    { value: "hourly", label: "De hora em hora" },
    { value: "cron", label: "Avançado (cron)" },
  ], presetKind);

  const timeIn = input({ type: "time", value: schedule.preset?.time || "08:00" });
  const weekdaySel = select(WEEKDAYS.map((l, v) => ({ value: String(v), label: l })), String(schedule.preset?.weekday ?? 1));
  const minuteIn = input({ type: "number", min: 0, max: 59, value: schedule.preset?.minute || 0 });
  const cronIn = input({ type: "text", value: schedule.kind === "cron" ? (schedule.cron || "0 8 * * *") : "0 8 * * *", placeholder: "0 8 * * *" });
  const tzIn = input({ type: "text", value: schedule.tz || "", placeholder: "America/Sao_Paulo (vazio = padrão do servidor)" });

  const detail = document.createElement("div");
  function renderDetail() {
    const m = modeSel.value;
    detail.replaceChildren();
    if (m === "daily" || m === "weekly") detail.appendChild(field("Horário", timeIn));
    if (m === "weekly") detail.appendChild(field("Dia da semana", weekdaySel));
    if (m === "hourly") detail.appendChild(field("Minuto da hora", minuteIn));
    if (m === "cron") detail.appendChild(field("Expressão cron", cronIn, "min hora dia-do-mês mês dia-da-semana"));
  }
  modeSel.addEventListener("change", renderDetail);
  renderDetail();

  wrap.appendChild(field("Frequência", modeSel));
  wrap.appendChild(detail);
  wrap.appendChild(field("Fuso horário", tzIn));

  function read() {
    const m = modeSel.value;
    const tz = tzIn.value.trim();
    if (m === "cron") return { kind: "cron", cron: cronIn.value.trim(), tz };
    if (m === "hourly") return { kind: "preset", preset: { kind: "hourly", minute: Number(minuteIn.value) || 0 }, tz };
    if (m === "weekly") return { kind: "preset", preset: { kind: "weekly", time: timeIn.value, weekday: Number(weekdaySel.value) }, tz };
    return { kind: "preset", preset: { kind: "daily", time: timeIn.value }, tz };
  }
  return { el: wrap, read };
}

/* ---------- forms de opções por tipo ---------- */

function writeRootField(label, value, c, helpText) {
  const roots = c.writeRoots || [];
  let el;
  let read;
  if (roots.length) {
    el = select(roots.map((r) => ({ value: r, label: r })), value || roots[0]);
    read = () => el.value;
  } else {
    el = input({ type: "text", value: value || "", placeholder: "configure FS_WRITE_ROOTS no servidor" });
    read = () => el.value.trim();
  }
  return { field: field(label, el, helpText), read };
}

function optionsForm(type, options, c) {
  options = options || {};
  const wrap = document.createElement("div");

  if (type === "web_search_digest") {
    const queries = textarea((options.queries || []).join("\n"), 3, "uma busca por linha");
    const connSel = select((c.connections || []).map((x) => ({ value: x.id, label: x.nickname || x.baseUrl })), options.connectionId || "");
    const model = input({ type: "text", value: options.model || "", placeholder: "vazio = modelo padrão da conexão" });
    const sys = textarea(options.systemPrompt || "", 3, "instruções de resumo");
    const maxPer = input({ type: "number", min: 1, max: 10, value: options.maxResultsPerQuery || 5 });
    const outRoot = writeRootField("Pasta de saída", options.outputWriteRoot, c);
    const outDir = input({ type: "text", value: options.outputRelDir || "boletins", placeholder: "boletins" });
    const notify = checkbox("Notificar quando concluir", options.notify ?? true, () => {});
    const dedupe = checkbox("Marcar o que é novo vs. último boletim", options.dedupeAgainstLast ?? true, () => {});

    wrap.appendChild(field("Buscas", queries));
    if (!(c.connections || []).length) wrap.appendChild(errorCard("Crie uma conexão LLM acima primeiro."));
    wrap.appendChild(field("Conexão LLM", connSel));
    wrap.appendChild(field("Modelo", model));
    wrap.appendChild(field("Prompt de sistema", sys));
    wrap.appendChild(field("Resultados por busca", maxPer));
    wrap.appendChild(outRoot.field);
    wrap.appendChild(field("Subpasta", outDir));
    wrap.appendChild(notify);
    wrap.appendChild(dedupe);

    return {
      el: wrap,
      read: () => ({
        queries: queries.value.split("\n").map((s) => s.trim()).filter(Boolean),
        connectionId: connSel.value,
        model: model.value.trim(),
        systemPrompt: sys.value,
        maxResultsPerQuery: Number(maxPer.value) || 5,
        outputWriteRoot: outRoot.read(),
        outputRelDir: outDir.value.trim() || "boletins",
        notify: notify.querySelector("input").checked,
        dedupeAgainstLast: dedupe.querySelector("input").checked,
      }),
    };
  }

  if (type === "log_rotation") {
    const root = writeRootField("Pasta dos arquivos", options.writeRoot, c);
    const files = textarea((options.files || []).join("\n"), 3, "um caminho relativo por linha (ex: server.out.log)");
    const maxMb = input({ type: "number", min: 1, value: Math.round((options.maxSizeBytes || 5 * 1024 * 1024) / (1024 * 1024)) });
    const keep = input({ type: "number", min: 0, value: options.keep ?? 5 });
    const gzip = checkbox("Comprimir rotações (.gz)", options.gzip ?? true, () => {});

    wrap.appendChild(root.field);
    wrap.appendChild(field("Arquivos", files));
    wrap.appendChild(field("Tamanho máximo (MB)", maxMb));
    wrap.appendChild(field("Manter N rotações", keep));
    wrap.appendChild(gzip);

    return {
      el: wrap,
      read: () => ({
        writeRoot: root.read(),
        files: files.value.split("\n").map((s) => s.trim()).filter(Boolean),
        maxSizeBytes: (Number(maxMb.value) || 5) * 1024 * 1024,
        keep: Number(keep.value) || 0,
        gzip: gzip.querySelector("input").checked,
      }),
    };
  }

  if (type === "workspace_backup") {
    const root = writeRootField("Pasta de backup", options.backupWriteRoot, c);
    const dir = input({ type: "text", value: options.backupRelDir || "backups", placeholder: "backups" });
    const incState = checkbox("Incluir cron-state.json (contém segredos!)", options.includeCronState ?? true, () => {});
    const gzip = checkbox("Comprimir (.gz)", options.gzip ?? true, () => {});
    const sources = textarea((options.sources || []).map((s) => `${s.writeRoot}::${s.relPath}`).join("\n"), 3, "writeRoot::relPath por linha (opcional)");

    wrap.appendChild(root.field);
    wrap.appendChild(field("Subpasta", dir));
    wrap.appendChild(incState);
    wrap.appendChild(gzip);
    wrap.appendChild(field("Fontes extras", sources, "Cada linha: PASTA::caminho/relativo. Só arquivos dentro de FS_WRITE_ROOTS."));
    wrap.appendChild(help("Conversas/perfis/configurações ficam no navegador e NÃO são vistas pelo servidor — exporte-as pela aba correspondente."));

    return {
      el: wrap,
      read: () => ({
        backupWriteRoot: root.read(),
        backupRelDir: dir.value.trim() || "backups",
        includeCronState: incState.querySelector("input").checked,
        gzip: gzip.querySelector("input").checked,
        sources: sources.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [wr, ...rest] = l.split("::");
          return { writeRoot: (wr || "").trim(), relPath: rest.join("::").trim() };
        }).filter((s) => s.writeRoot && s.relPath),
      }),
    };
  }

  if (type === "agent_pipeline") {
    const conns = c.connections || [];
    const connOpts = conns.map((x) => ({ value: x.id, label: x.nickname || x.baseUrl }));
    const wsRoots = c.workspaceRoots || [];
    // Agentes manuais (os espelhados de perfil saem da lista — perfis vão no grupo "Perfis").
    const agentOpts = (c.agents || []).filter((a) => !a.sourceProfileId).map((a) => ({ value: a.id, label: a.name || "Agente" }));
    const profileOpts = chatProfiles().map((p) => ({ value: p.id, label: p.name || p.id }));
    let mode = options.mode === "advanced" ? "advanced" : "standard";
    const insertToken = (ta, token) => { ta.focus(); const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(token, s, e, "end"); };
    function nextStepId() {
      const ids = new Set(stepData.map((s) => s.id));
      let n = stepData.length + 1;
      while (ids.has("step" + n)) n++;
      return "step" + n;
    }

    // Seletor de pasta de LEITURA (WORKSPACE_ROOTS). Inclui opção "padrão da cascata".
    function readRootSelect(value, withDefault) {
      if (wsRoots.length) {
        const opts = wsRoots.map((r) => ({ value: r, label: r }));
        const el = select(withDefault ? [{ value: "", label: "(padrão da cascata)" }, ...opts] : opts, value || "");
        return { el, read: () => el.value };
      }
      const el = input({ type: "text", value: value || "", placeholder: "configure WORKSPACE_ROOTS no servidor" });
      return { el, read: () => el.value.trim() };
    }

    // Estado local da lista de passos. Reorder/add/remove mexem AQUI e re-renderizam
    // só o stepsHost — NÃO o rerender() global (que recarregaria do servidor e
    // descartaria edições em andamento). Antes de cada mutação, syncFromDom() puxa os
    // valores atuais dos inputs de volta pro stepData.
    const stepData = (options.steps || []).map((s) => ({
      id: s.id || "", name: s.name || "", profileId: s.profileId || "", agentId: s.agentId || "", connectionId: s.connectionId || "",
      model: s.model || "", systemPrompt: s.systemPrompt || "", prompt: s.prompt || "",
      temperature: s.temperature ?? 0.3,
      webSearch: {
        enabled: !!(s.webSearch && s.webSearch.enabled),
        query: (s.webSearch && s.webSearch.query) || "",
        maxResults: (s.webSearch && s.webSearch.maxResults) || 5,
      },
      fileRead: {
        enabled: !!(s.fileRead && s.fileRead.enabled),
        sourceRoot: (s.fileRead && s.fileRead.sourceRoot) || "",
        relPath: (s.fileRead && s.fileRead.relPath) || "",
      },
    }));

    const stepsHost = document.createElement("div");
    let refs = [];
    function syncFromDom() {
      refs.forEach((r, i) => { if (r && stepData[i]) Object.assign(stepData[i], r.read()); });
    }

    function renderSteps() {
      stepsHost.replaceChildren();
      refs = [];
      const adv = mode === "advanced";
      stepData.forEach((sd, i) => {
        // Origem do passo: Perfil de chat | Agente do cron | inline
        const srcSel = document.createElement("select");
        srcSel.appendChild(new Option("inline", ""));
        if (profileOpts.length) {
          const g = document.createElement("optgroup"); g.label = "Perfis";
          profileOpts.forEach((o) => g.appendChild(new Option(o.label, "p:" + o.value)));
          srcSel.appendChild(g);
        }
        if (agentOpts.length) {
          const g = document.createElement("optgroup"); g.label = "Agentes";
          agentOpts.forEach((o) => g.appendChild(new Option(o.label, o.value)));
          srcSel.appendChild(g);
        }
        srcSel.value = sd.profileId ? "p:" + sd.profileId : (sd.agentId || "");
        const isInline = () => srcSel.value === "";
        const usingProfile = () => srcSel.value.startsWith("p:");
        const usingAgentRef = () => srcSel.value !== "" && !usingProfile();
        const nameIn = input({ type: "text", value: sd.name, placeholder: "Passo " + (i + 1) });
        nameIn.style.width = "100%";
        const promptIn = textarea(sd.prompt, 3, usingAgentRef() ? "(usa a instrução padrão do agente)" : "Escreva o que este agente deve fazer…");
        let idIn = null, connSel = null, modelIn = null, sysIn = null, tempIn = null;
        let wsEnabled = null, wsQuery = null, wsMax = null, frEnabled = null, frRoot = null, frRel = null;

        const cardEl = card([]);
        cardEl.classList.add("cron-step");

        // Cabeçalho compacto: índice · nome · agente · ações
        const hd = document.createElement("div");
        hd.className = "cron-step-head";
        const idx = document.createElement("span");
        idx.className = "step-idx";
        idx.textContent = String(i + 1);
        hd.appendChild(idx);
        const nameWrap = document.createElement("div");
        nameWrap.className = "grow";
        nameWrap.appendChild(nameIn);
        hd.appendChild(nameWrap);
        srcSel.addEventListener("change", () => { syncFromDom(); renderSteps(); });
        if (profileOpts.length || agentOpts.length) hd.appendChild(srcSel);
        const up = button("↑", "btn-ghost btn-sm", () => { syncFromDom(); if (i > 0) { const t = stepData[i - 1]; stepData[i - 1] = stepData[i]; stepData[i] = t; renderSteps(); } });
        const down = button("↓", "btn-ghost btn-sm", () => { syncFromDom(); if (i < stepData.length - 1) { const t = stepData[i + 1]; stepData[i + 1] = stepData[i]; stepData[i] = t; renderSteps(); } });
        const del = button("×", "btn-ghost btn-sm", () => { syncFromDom(); stepData.splice(i, 1); renderSteps(); });
        if (i === 0) up.disabled = true;
        if (i === stepData.length - 1) down.disabled = true;
        hd.appendChild(up); hd.appendChild(down); hd.appendChild(del);
        cardEl.appendChild(hd);

        // Instrução (sempre visível)
        cardEl.appendChild(promptIn);

        if (adv) {
          // botões de inserir token (clica em vez de digitar {{ }})
          const ins = document.createElement("div");
          ins.className = "row";
          const prev = i > 0 ? stepData[i - 1].id : "";
          const b1 = button("↪ saída anterior", "btn-ghost btn-sm", () => insertToken(promptIn, `{{steps.${prev}.output}}`));
          if (!prev) b1.disabled = true;
          ins.appendChild(b1);
          ins.appendChild(button("📅 data", "btn-ghost btn-sm", () => insertToken(promptIn, "{{date}}")));
          ins.appendChild(button("{x} variável", "btn-ghost btn-sm", () => insertToken(promptIn, "{{vars.}}")));
          cardEl.appendChild(ins);

          idIn = input({ type: "text", value: sd.id, placeholder: "id_unico" });
          tempIn = input({ type: "number", min: 0, max: 2, step: 0.1, value: sd.temperature });
          const grid = document.createElement("div");
          grid.className = "row cols2";
          grid.appendChild(field("ID", idIn));
          grid.appendChild(field("Temperatura", tempIn));
          cardEl.appendChild(grid);

          if (isInline()) {
            connSel = select(connOpts, sd.connectionId || (connOpts[0] && connOpts[0].value) || "");
            modelIn = input({ type: "text", value: sd.model, placeholder: "vazio = modelo da conexão" });
            sysIn = textarea(sd.systemPrompt, 2, "persona (opcional)");
            cardEl.appendChild(field("Conexão", connSel));
            cardEl.appendChild(field("Modelo", modelIn));
            cardEl.appendChild(field("Persona", sysIn));
            wsEnabled = checkbox("Buscar na web antes", sd.webSearch.enabled, () => {});
            wsQuery = input({ type: "text", value: sd.webSearch.query, placeholder: "o que buscar" });
            wsMax = input({ type: "number", min: 1, max: 10, value: sd.webSearch.maxResults });
            frEnabled = checkbox("Ler um arquivo local antes", sd.fileRead.enabled, () => {});
            frRoot = readRootSelect(sd.fileRead.sourceRoot, true);
            frRel = input({ type: "text", value: sd.fileRead.relPath, placeholder: "caminho/relativo.md" });
            cardEl.appendChild(wsEnabled);
            cardEl.appendChild(field("Busca", wsQuery));
            cardEl.appendChild(field("Resultados por busca", wsMax));
            cardEl.appendChild(frEnabled);
            cardEl.appendChild(field("Pasta de leitura", frRoot.el));
            cardEl.appendChild(field("Arquivo a ler", frRel));
          }
        } else if (isInline()) {
          // Standard inline: conexão + busca recolhidas em "⚙ ferramentas"
          const tools = collapsible("⚙ ferramentas");
          connSel = select(connOpts, sd.connectionId || (connOpts[0] && connOpts[0].value) || "");
          wsEnabled = checkbox("Buscar na web antes", sd.webSearch.enabled, () => {});
          wsQuery = input({ type: "text", value: sd.webSearch.query, placeholder: "o que buscar" });
          tools.body.appendChild(field("Conexão", connSel));
          tools.body.appendChild(wsEnabled);
          tools.body.appendChild(field("Busca", wsQuery));
          cardEl.appendChild(tools.el);
        }

        stepsHost.appendChild(cardEl);
        refs.push({
          read: () => ({
            id: idIn ? (idIn.value.trim() || sd.id) : sd.id,
            name: nameIn.value.trim(),
            profileId: srcSel.value.startsWith("p:") ? srcSel.value.slice(2) : "",
            agentId: srcSel.value && !srcSel.value.startsWith("p:") ? srcSel.value : "",
            connectionId: connSel ? connSel.value : sd.connectionId,
            model: modelIn ? modelIn.value.trim() : sd.model,
            systemPrompt: sysIn ? sysIn.value : sd.systemPrompt,
            prompt: promptIn.value,
            temperature: tempIn ? Number(tempIn.value) : sd.temperature,
            webSearch: wsEnabled
              ? { enabled: wsEnabled.querySelector("input").checked, query: wsQuery.value.trim(), maxResults: wsMax ? (Number(wsMax.value) || 5) : (sd.webSearch.maxResults || 5) }
              : sd.webSearch,
            fileRead: frEnabled
              ? { enabled: frEnabled.querySelector("input").checked, sourceRoot: frRoot.read(), relPath: frRel.value.trim() }
              : sd.fileRead,
          }),
        });
      });
    }
    renderSteps();

    const addBtn = button("+ Passo", "btn-secondary", () => {
      syncFromDom();
      stepData.push({
        id: nextStepId(), name: "", profileId: "", agentId: "",
        connectionId: (connOpts[0] && connOpts[0].value) || "",
        model: "", systemPrompt: "", prompt: "", temperature: 0.3,
        webSearch: { enabled: false, query: "", maxResults: 5 },
        fileRead: { enabled: false, sourceRoot: "", relPath: "" },
      });
      renderSteps();
    });

    const autoChain = checkbox("Encadear automaticamente (cada passo recebe a saída dos anteriores)", options.autoChain !== false, () => {});
    const varsIn = textarea(Object.entries(options.vars || {}).map(([k, v]) => `${k}=${v}`).join("\n"), 2, "chave=valor por linha (ex: topico=IA local)");
    const outRoot = writeRootField("Pasta de saída", options.outputWriteRoot, c);
    const outDir = input({ type: "text", value: options.outputRelDir || "pipelines", placeholder: "pipelines" });
    const outTitle = input({ type: "text", value: options.outputTitle || "", placeholder: "vazio = nome da tarefa" });
    const readRoot = readRootSelect(options.fileReadRoot, false);
    const notify = checkbox("Notificar quando concluir", options.notify ?? true, () => {});

    // Extras só do modo Avançado (escondidos no Standard).
    const advBox = document.createElement("div");
    advBox.style.cssText = "display:flex;flex-direction:column;gap:var(--s-3);";
    advBox.appendChild(autoChain);
    advBox.appendChild(field("Variáveis", varsIn));
    advBox.appendChild(field("Pasta de leitura padrão", readRoot.el, "WORKSPACE_ROOTS — pros passos que leem arquivo."));
    function updateModeVisibility() { advBox.style.display = mode === "advanced" ? "" : "none"; }

    // Saída recolhida (pasta/subpasta/título/notificação).
    const saida = collapsible("Saída", { suffix: options.outputRelDir || "pipelines" });
    if (c.writeRoots && c.writeRoots.length) saida.body.appendChild(help(`Grava em: ${c.writeRoots.join(", ")}`));
    saida.body.appendChild(outRoot.field);
    saida.body.appendChild(field("Subpasta", outDir));
    saida.body.appendChild(field("Título do documento", outTitle));
    saida.body.appendChild(notify);

    // Controle segmentado Standard | Avançado.
    const seg = segmented(
      [{ value: "standard", label: "Standard" }, { value: "advanced", label: "Avançado" }],
      mode,
      (v) => { syncFromDom(); mode = v; updateModeVisibility(); renderSteps(); }
    );
    const modeRow = document.createElement("div");
    modeRow.className = "row";
    modeRow.style.justifyContent = "space-between";
    const modeLbl = document.createElement("span");
    modeLbl.className = "field-label";
    modeLbl.textContent = "Modo";
    modeRow.appendChild(modeLbl);
    modeRow.appendChild(seg.el);
    updateModeVisibility();

    if (!conns.length && !profileOpts.length) wrap.appendChild(errorCard("Crie um perfil (aba Servidor/Perfis) ou uma conexão LLM (em “Conexões e agentes”) primeiro."));
    wrap.appendChild(modeRow);
    wrap.appendChild(stepsHost);
    wrap.appendChild(addBtn);
    wrap.appendChild(advBox);
    wrap.appendChild(saida.el);

    return {
      el: wrap,
      read: () => {
        syncFromDom();
        const vars = {};
        varsIn.value.split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => {
          const eq = l.indexOf("=");
          if (eq > 0) vars[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
        });
        return {
          mode,
          autoChain: autoChain.querySelector("input").checked,
          steps: stepData.map((s) => ({
            id: s.id, name: s.name, profileId: s.profileId, agentId: s.agentId, connectionId: s.connectionId, model: s.model,
            systemPrompt: s.systemPrompt, prompt: s.prompt, temperature: s.temperature,
            webSearch: s.webSearch, fileRead: s.fileRead,
          })),
          vars,
          outputWriteRoot: outRoot.read(),
          outputRelDir: outDir.value.trim() || "pipelines",
          outputTitle: outTitle.value.trim(),
          fileReadRoot: readRoot.read(),
          notify: notify.querySelector("input").checked,
        };
      },
    };
  }

  wrap.appendChild(help(`Tipo "${type}" sem formulário específico.`));
  return { el: wrap, read: () => ({}) };
}

/* ---------- visualizador de resultado ---------- */

async function openResult(task) {
  let data;
  try {
    data = await cronResult(task.id, null);
  } catch (e) {
    state.toast(`Sem resultado: ${e.message}`, "warn");
    return;
  }
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;";
  const box = document.createElement("div");
  box.style.cssText = "background:var(--bg,#161616);color:var(--text,#eee);max-width:860px;width:100%;max-height:85vh;overflow:auto;border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.5);";
  const close = button("Fechar", "btn-ghost", () => overlay.remove());
  close.style.float = "right";
  box.appendChild(close);
  if (data.content) {
    const md = document.createElement("div");
    md.className = "markdown";
    md.appendChild(renderMarkdown(data.content));
    box.appendChild(md);
  } else {
    box.appendChild(help(`Última execução: ${data.status || "?"}. ${data.error ? "Erro: " + data.error : "Nenhum arquivo gerado ainda — rode a tarefa."}`));
  }
  overlay.appendChild(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
