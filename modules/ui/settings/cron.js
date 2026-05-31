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
  cronUpsertConnection, cronDeleteConnection,
} from "../../api.js";
import { renderMarkdown } from "../../markdown.js";

let cache = null;          // última resposta de /api/cron/list
let editingTaskId = null;  // "new" | id | null
let newTaskType = "web_search_digest";
let editingConnId = null;  // "new" | id | null
let hostEl = null;         // container atual (pra re-render in-place sem perder editingId)

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function panelCron() {
  // Entrada da aba: começa limpo (sem editor aberto).
  editingTaskId = null;
  editingConnId = null;
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
  host.appendChild(connectionsSection(cache));
  host.appendChild(tasksSection(cache));
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

/* ---------- banner / status ---------- */

function statusBanner(c) {
  const div = card([]);
  const row = document.createElement("div");
  row.className = "row";
  row.style.alignItems = "center";
  row.appendChild(badge(c.enabled ? "Motor ATIVO" : "Motor DESLIGADO", c.enabled ? "ok" : "null"));
  const info = document.createElement("span");
  info.style.fontSize = "12px";
  info.style.color = "var(--text-muted, #888)";
  const roots = (c.writeRoots && c.writeRoots.length) ? c.writeRoots.join(", ") : "(nenhuma — defina FS_WRITE_ROOTS)";
  info.textContent = `Pastas de escrita: ${roots}`;
  row.appendChild(info);
  div.appendChild(row);
  return div;
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
  const sec = section("Conexões LLM (headless)");
  sec.appendChild(help(
    "As tarefas rodam sem o navegador aberto, então usam conexões próprias (não o servidor de chat do localStorage). " +
    "Aponte para o LM Studio local OU um endpoint sempre-online (ex: OpenRouter) para o boletim rodar de madrugada."
  ));
  for (const conn of c.connections) {
    sec.appendChild(editingConnId === conn.id ? connectionEditor(conn, c) : connectionCard(conn));
  }
  if (editingConnId === "new") sec.appendChild(connectionEditor(null, c));

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("+ Nova conexão", "btn-secondary", () => { editingConnId = "new"; rerender(); }));
  actions.appendChild(button("Copiar do servidor de chat", "btn-ghost", copyFromChatServer));
  sec.appendChild(actions);
  return sec;
}

function connectionCard(conn) {
  const c = card([]);
  const title = document.createElement("div");
  title.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
  const name = document.createElement("strong");
  name.textContent = conn.nickname || conn.baseUrl;
  title.appendChild(name);
  const btns = document.createElement("div");
  btns.className = "row";
  btns.appendChild(button("Editar", "btn-ghost", () => { editingConnId = conn.id; rerender(); }));
  btns.appendChild(button("×", "btn-ghost", async () => {
    try { await cronDeleteConnection(conn.id); rerender(); }
    catch (e) { state.toast(e.message, "error"); }
  }));
  title.appendChild(btns);
  c.appendChild(title);
  c.appendChild(help(`${conn.baseUrl}  ·  modelo: ${conn.model || "—"}  ·  chave: ${conn.hasApiKey ? (conn.apiKeyEnv ? `env ${conn.apiKeyEnv}` : "definida") : "nenhuma"}`));
  return c;
}

function connectionEditor(conn, c) {
  const editing = !!conn;
  const wrap = card([]);
  const nick = input({ type: "text", value: conn?.nickname || "", placeholder: "Apelido (ex: OpenRouter)" });
  const baseUrl = input({ type: "text", value: conn?.baseUrl || "", placeholder: "https://openrouter.ai/api/v1" });
  const model = input({ type: "text", value: conn?.model || "", placeholder: "google/gemini-2.5-flash:free" });
  const apiKey = input({ type: "password", value: "", placeholder: editing && conn.hasApiKey ? "*** (em branco mantém a atual)" : "API key (opcional)" });
  const apiKeyEnv = input({ type: "text", value: conn?.apiKeyEnv || "", placeholder: "ou nome de env var (ex: OPENROUTER_KEY)" });

  wrap.appendChild(field("Apelido", nick));
  wrap.appendChild(field("Base URL", baseUrl, "Mesma política SSRF do proxy (ALLOWED_LM_HOSTS em LAN)."));
  wrap.appendChild(field("Modelo padrão", model));
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
      baseUrl: srv.baseUrl, apiKey: srv.apiKey || "", model: "",
    });
    state.toast("Conexão copiada do servidor de chat.", "success");
    rerender();
  } catch (e) { state.toast(e.message, "error"); }
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
  if (task.type === "web_search_digest") {
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

  const name = input({ type: "text", value: task?.name || reg.label, placeholder: "Nome da tarefa" });
  wrap.appendChild(field("Nome", name));

  if (editing) {
    wrap.appendChild(field("Tipo", (() => { const s = document.createElement("div"); s.textContent = reg.label; return s; })()));
  } else {
    const typeSel = select(c.registry.map((r) => ({ value: r.type, label: r.label })), type);
    typeSel.addEventListener("change", () => { newTaskType = typeSel.value; rerender(); });
    wrap.appendChild(field("Tipo", typeSel));
  }

  const enabled = checkbox("Ativa", task?.enabled ?? false, () => {});
  wrap.appendChild(enabled);

  const sched = schedulePicker(task?.schedule);
  wrap.appendChild(sched.el);

  const opts = optionsForm(type, task?.options || reg.defaultOptions, c);
  wrap.appendChild(opts.el);

  // política (avançado)
  const det = document.createElement("details");
  const sum = document.createElement("summary");
  sum.textContent = "Opções avançadas (política de execução)";
  det.appendChild(sum);
  const catchUp = checkbox("Executar no boot se perdeu o horário (catch-up)", task?.policy?.catchUpOnStart ?? false, () => {});
  const timeoutS = input({ type: "number", min: 1, value: Math.round((task?.policy?.timeoutMs || 120000) / 1000) });
  det.appendChild(catchUp);
  det.appendChild(field("Timeout (segundos)", timeoutS));
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
