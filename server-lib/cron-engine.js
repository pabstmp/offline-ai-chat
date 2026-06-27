/* server-lib/cron-engine.js — motor de agendamento extensível.
 *
 * Um único ticker (setInterval de 30s) avalia TODAS as tarefas em cada passo —
 * NÃO há um timer por tarefa. Isso torna o agendamento uma função pura de
 * (now, tasks): determinístico, testável (chame tick(fakeNow)), reconciliável
 * após restart (recomputa nextRunAt do lastRunAt persistido) e serializa
 * naturalmente o overlap-guard.
 *
 * Garantias operacionais:
 *  - overlap = skip (nunca enfileira; evita backlog de chamadas LLM)
 *  - timeout por tarefa via AbortController
 *  - catch-up de execução perdida roda no máx. 1x no boot (não N vezes)
 *  - disjuntor: desabilita a tarefa após N falhas consecutivas
 *  - persistência atômica em cron-state.json (sobrevive a restart/Docker)
 *
 * Fonte de verdade: o objeto em memória `S`. O arquivo é só a projeção durável.
 * Segredos (apiKey de conexões) NUNCA saem por getPublicState (são redigidos).
 */
"use strict";

const fsp = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { parseCron, nextRunAfter, resolveCron, partsInTz, isValidTimeZone } = require("./cron-expr");

const HISTORY_MAX = 20;
const DEFAULT_TICK_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 250;

const DEFAULT_DIGEST_SYSTEM =
  "Você é um analista que compila boletins informativos. Receberá resultados de " +
  "busca na web e deve produzir um resumo claro em markdown, em português, " +
  "destacando os pontos mais relevantes e citando as fontes por link. Não invente " +
  "informações além do que está nos resultados.";

/* ---------- helpers puros (exportados pra teste) ---------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateInTz(ms, tz) {
  const p = partsInTz(new Date(ms), tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function formatStampInTz(ms, tz) {
  const p = partsInTz(new Date(ms), tz);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}-${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
}

/** Conteúdo do prompt de usuário a partir dos grupos de resultados. */
function buildDigestPrompt(groups) {
  const lines = ["Resultados de busca coletados:"];
  for (const g of groups) {
    lines.push(`\n## Busca: ${g.query}`);
    if (!g.results || !g.results.length) {
      lines.push("(sem resultados)");
      continue;
    }
    g.results.forEach((r, i) => {
      const tag = r.isNew ? " [NOVO]" : "";
      lines.push(`${i + 1}. ${r.title || r.url}${tag}\n   ${r.url}\n   ${r.snippet || ""}`);
    });
  }
  lines.push("\nEscreva o boletim em markdown, em português, citando as fontes por link.");
  return lines.join("\n");
}

/** Markdown final do boletim. */
function renderDigestMarkdown({ title, dateStr, groups, summary }) {
  const out = [];
  out.push(`# ${title || "Boletim"}`);
  out.push("");
  out.push(`_Gerado em ${dateStr}_`);
  out.push("");
  out.push(summary && summary.trim() ? summary.trim() : "_(sem resumo)_");
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Fontes");
  for (const g of groups) {
    out.push("");
    out.push(`### ${g.query}`);
    if (!g.results || !g.results.length) {
      out.push("_(sem resultados)_");
      continue;
    }
    for (const r of g.results) {
      const tag = r.isNew ? " **(novo)**" : "";
      const snip = r.snippet ? ` — ${r.snippet}` : "";
      out.push(`- [${r.title || r.url}](${r.url})${tag}${snip}`);
    }
  }
  out.push("");
  return out.join("\n");
}

function checkAbort(signal) {
  if (signal && signal.aborted) {
    const e = new Error("Tarefa abortada (timeout).");
    e.name = "AbortError";
    throw e;
  }
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

/**
 * Interpola tokens `{{...}}` num template, em UMA passada (não-recursivo: valores
 * já substituídos não são re-escaneados, então output de LLM não injeta novos
 * tokens). Tokens suportados: `{{vars.<k>}}`, `{{steps.<id>.output}}`, `{{date}}`.
 * Token desconhecido ou caminho ausente vira string vazia — nunca lança (não
 * quebra a tarefa às 3h). Função pura de (tmpl, scope).
 */
function interpolateTemplate(tmpl, scope) {
  if (typeof tmpl !== "string") return tmpl == null ? "" : String(tmpl);
  const s = scope || {};
  return tmpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, token) => {
    if (token === "date") return s.date != null ? String(s.date) : "";
    const parts = token.split(".");
    if (parts[0] === "vars" && parts.length === 2) {
      const v = s.vars && s.vars[parts[1]];
      return v == null ? "" : String(v);
    }
    if (parts[0] === "steps" && parts.length === 3 && parts[2] === "output") {
      const st = s.steps && s.steps[parts[1]];
      return st && st.output != null ? String(st.output) : "";
    }
    return "";
  });
}

/** Bloco de texto com os resultados de busca de um passo (pra colar no prompt). */
function buildSearchBlock(query, results) {
  const lines = [`Resultados de busca para "${query}":`];
  if (!results || !results.length) {
    lines.push("(sem resultados)");
  } else {
    results.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title || r.url}\n   ${r.url}\n   ${r.snippet || ""}`);
    });
  }
  return lines.join("\n");
}

/**
 * Bloco de "contexto dos passos anteriores" pro encadeamento AUTOMÁTICO (modo Standard):
 * cada passo recebe a saída dos anteriores sem o usuário digitar nenhum token.
 * Função pura de (priorSummaries, results). Retorna "" se não há nada antes.
 */
function buildPriorContext(priorSummaries, results) {
  const parts = [];
  for (const s of priorSummaries || []) {
    const out = results && results[s.id] ? results[s.id].output : "";
    if (out && String(out).trim()) parts.push(`## ${s.name || s.id}\n${out}`);
  }
  if (!parts.length) return "";
  return `Resultado dos passos anteriores:\n\n${parts.join("\n\n")}`;
}

/** Aplica campos de sampling suportados (não-nulos) num payload OpenAI. Puro.
   NÃO mexe em `temperature` (resolvida à parte). Espelha o `sampling` do perfil. */
function applySampling(payload, sampling) {
  if (!sampling || typeof sampling !== "object") return payload;
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const fields = ["top_p", "max_tokens", "top_k", "min_p", "repeat_penalty", "presence_penalty", "frequency_penalty"];
  for (const f of fields) {
    const v = num(sampling[f]);
    if (v !== undefined) payload[f] = v;
  }
  if (Array.isArray(sampling.stop) && sampling.stop.length) payload.stop = sampling.stop;
  return payload;
}

/** Markdown final de uma cascata: saída do último passo + resumo dos passos. */
function renderPipelineMarkdown({ title, dateStr, steps, finalOutput }) {
  const out = [];
  out.push(`# ${title || "Pipeline"}`);
  out.push("");
  out.push(`_Gerado em ${dateStr}_`);
  out.push("");
  out.push(finalOutput && finalOutput.trim() ? finalOutput.trim() : "_(sem saída)_");
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Passos");
  (steps || []).forEach((s, i) => {
    const tools = [];
    if (s.searched) tools.push("busca web");
    if (s.readFile) tools.push("leitura de arquivo");
    const toolStr = tools.length ? ` · ${tools.join(", ")}` : "";
    out.push(`${i + 1}. **${s.name || s.id}** — \`${s.model}\`${toolStr} (${s.chars} chars)`);
  });
  out.push("");
  return out.join("\n");
}

/* ---------- registry de tarefas ---------- */

const TASK_REGISTRY = {
  web_search_digest: {
    label: "Boletim de busca web",
    defaultOptions() {
      return {
        queries: [],
        connectionId: "",
        model: "",
        systemPrompt: DEFAULT_DIGEST_SYSTEM,
        maxResultsPerQuery: 5,
        outputWriteRoot: "",
        outputRelDir: "boletins",
        notify: true,
        dedupeAgainstLast: true,
      };
    },
    validateOptions(opts) {
      const errors = [];
      if (!asStringArray(opts.queries).length) errors.push("queries vazias");
      if (!opts.connectionId) errors.push("connectionId obrigatório");
      if (!opts.outputWriteRoot) errors.push("outputWriteRoot obrigatório");
      return { ok: errors.length === 0, errors };
    },
    async run(task, ctx) {
      const opts = task.options;
      const conn = ctx.resolveConnection(opts.connectionId);
      if (!conn) throw new Error("conexão LLM não configurada para esta tarefa.");

      const queries = asStringArray(opts.queries);
      const maxPer = Math.max(1, Math.min(10, Number(opts.maxResultsPerQuery) || 5));

      // 1. coleta + dedup de URLs entre queries
      const groups = [];
      const seenUrls = new Set();
      for (const q of queries) {
        checkAbort(ctx.signal);
        let r;
        try {
          r = await ctx.deps.webSearch(q);
        } catch (e) {
          r = { results: [], provider: "erro", error: e.message };
        }
        const results = [];
        for (const item of (r.results || []).slice(0, maxPer)) {
          if (!item || !item.url || seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          results.push({ title: item.title, url: item.url, snippet: item.snippet });
        }
        groups.push({ query: q, provider: r.provider, results });
      }

      // 2. diff vs. última execução bem-sucedida (marca "novos")
      if (opts.dedupeAgainstLast) {
        const hist = ctx.getHistory(task.id);
        const lastOk = hist.find((h) => h.status === "ok" && h.summary && Array.isArray(h.summary.urls));
        if (lastOk) {
          const prev = new Set(lastOk.summary.urls);
          for (const g of groups) for (const r of g.results) r.isNew = !prev.has(r.url);
        }
      }

      // 3. resume via LLM in-process
      checkAbort(ctx.signal);
      const llm = await ctx.deps.callLLMOnce({
        baseUrl: conn.baseUrl,
        apiKey: conn.apiKey,
        payload: {
          model: opts.model || conn.model,
          messages: [
            { role: "system", content: opts.systemPrompt || DEFAULT_DIGEST_SYSTEM },
            { role: "user", content: buildDigestPrompt(groups) },
          ],
          temperature: 0.3,
        },
        timeoutMs: ctx.timeoutMs,
        signal: ctx.signal,
      });

      // 4. escreve markdown datado
      const dateStr = formatDateInTz(ctx.now, ctx.tz);
      const markdown = renderDigestMarkdown({ title: task.name, dateStr, groups, summary: llm.content });
      const dir = String(opts.outputRelDir || "boletins").replace(/^[\\/]+|[\\/]+$/g, "") || "boletins";
      const fileRel = `${dir}/boletim-${dateStr}.md`;
      const { absolute } = ctx.deps.safeWriter.resolveSafeWritePath(opts.outputWriteRoot, fileRel);
      const bytes = await ctx.deps.safeWriter.writeTextFileAtomically(absolute, markdown);

      return {
        fileRel,
        writeRoot: opts.outputWriteRoot,
        bytes,
        queryCount: queries.length,
        resultCount: seenUrls.size,
        model: opts.model || conn.model,
        snippet: markdown.slice(0, 400),
        urls: [...seenUrls],
        notify: !!opts.notify,
      };
    },
  },

  agent_pipeline: {
    label: "Cascata de agentes",
    defaultOptions() {
      return {
        steps: [],
        vars: {},
        outputWriteRoot: "",
        outputRelDir: "pipelines",
        outputTitle: "",
        fileReadRoot: "",
        notify: true,
        mode: "standard", // "standard" | "advanced" — dirige só a UI
        autoChain: true, // encadeamento automático: cada passo recebe a saída dos anteriores
      };
    },
    validateOptions(opts) {
      const errors = [];
      const steps = Array.isArray(opts.steps) ? opts.steps : [];
      if (!steps.length) errors.push("nenhum passo definido");
      if (!opts.outputWriteRoot) errors.push("outputWriteRoot obrigatório");
      const seen = new Set();
      for (const s of steps) {
        const id = String((s && s.id) || "").trim();
        if (!id) {
          errors.push("passo sem id");
          continue;
        }
        if (!/^[A-Za-z0-9_-]+$/.test(id)) errors.push(`passo "${id}": id inválido (use letras, números, _ ou -)`);
        if (seen.has(id)) errors.push(`id de passo duplicado: "${id}"`);
        seen.add(id);
        // Passo válido se referencia um agente salvo OU define conexão+prompt inline.
        const hasAgent = !!s.agentId;
        if (!hasAgent && !s.connectionId) errors.push(`passo "${id}": escolha um agente ou uma conexão`);
        if (!hasAgent && !String(s.prompt || "").trim()) errors.push(`passo "${id}": instrução vazia`);
        if (s.webSearch && s.webSearch.enabled && !String(s.webSearch.query || "").trim())
          errors.push(`passo "${id}": busca web habilitada sem query`);
        if (s.fileRead && s.fileRead.enabled && !String(s.fileRead.relPath || "").trim())
          errors.push(`passo "${id}": leitura de arquivo habilitada sem caminho`);
      }
      return { ok: errors.length === 0, errors };
    },
    async run(task, ctx) {
      const opts = task.options;
      const steps = Array.isArray(opts.steps) ? opts.steps : [];
      if (!steps.length) throw new Error("pipeline sem passos.");
      const vars = opts.vars && typeof opts.vars === "object" ? opts.vars : {};
      const dateStr = formatDateInTz(ctx.now, ctx.tz);
      // Orçamento de timeout: divide o cap global entre os passos. O AbortController
      // único da engine continua como hard-stop do run() inteiro.
      const perStepTimeout = Math.max(5000, Math.floor((ctx.timeoutMs || 120000) / steps.length));

      const autoChain = opts.autoChain !== false;
      const results = {}; // id -> { output }
      const stepSummaries = [];
      for (let idx = 0; idx < steps.length; idx++) {
        const step = steps[idx];
        checkAbort(ctx.signal);
        const id = String(step.id || "").trim();

        // Resolve config efetiva: agente salvo (persona + instrução padrão) + overrides do passo.
        const agent = step.agentId ? ctx.resolveAgent(step.agentId) : null;
        if (step.agentId && !agent) throw new Error(`passo "${id}": agente não encontrado.`);
        const conn = ctx.resolveConnection(step.connectionId || (agent && agent.connectionId));
        if (!conn) throw new Error(`passo "${id}": conexão LLM não configurada.`);
        const systemPrompt = step.systemPrompt || (agent && agent.systemPrompt) || "";
        const promptTmpl = String(step.prompt || "").trim() || (agent && agent.defaultPrompt) || "";
        const model = step.model || (agent && agent.model) || conn.model;
        const temp = Number.isFinite(Number(step.temperature))
          ? Number(step.temperature)
          : agent && Number.isFinite(Number(agent.temperature))
            ? Number(agent.temperature)
            : 0.3;
        const webSearch = step.webSearch || (agent && agent.tools && agent.tools.webSearch) || null;
        const fileRead = step.fileRead || (agent && agent.tools && agent.tools.fileRead) || null;
        const name = step.name || (agent && agent.name) || id;
        const scope = { vars, steps: results, date: dateStr };

        // (a) busca web ANTES do LLM (opcional)
        let searchBlock = "";
        let searched = false;
        if (webSearch && webSearch.enabled) {
          checkAbort(ctx.signal);
          searched = true;
          const q = interpolateTemplate(webSearch.query, scope);
          const max = Math.max(1, Math.min(10, Number(webSearch.maxResults) || 5));
          let r;
          try {
            r = await ctx.deps.webSearch(q);
          } catch (e) {
            r = { results: [], provider: "erro", error: e.message };
          }
          searchBlock = buildSearchBlock(q, (r.results || []).slice(0, max));
        }

        // (b) leitura de arquivo local ANTES do LLM (confinada a WORKSPACE_ROOTS)
        let fileBlock = "";
        let readFile = false;
        if (fileRead && fileRead.enabled) {
          checkAbort(ctx.signal);
          readFile = true;
          const root = fileRead.sourceRoot || opts.fileReadRoot;
          const rel = interpolateTemplate(fileRead.relPath, scope);
          const { content } = await ctx.deps.safeReader.readSafeTextFile(root, rel);
          fileBlock = `Conteúdo de ${rel}:\n${content}`;
        }

        // (c) encadeamento AUTOMÁTICO: se o prompt não referencia {{steps...}}
        //     explicitamente, prepende a saída dos passos anteriores (modo Standard,
        //     sem token). Token explícito suprime o prepend (evita duplicar).
        let chainBlock = "";
        if (autoChain && idx > 0 && !/\{\{\s*steps\./.test(promptTmpl)) {
          chainBlock = buildPriorContext(stepSummaries, results);
        }

        // (d) monta prompt do usuário e chama o LLM
        const userPrompt = [interpolateTemplate(promptTmpl, scope), chainBlock, searchBlock, fileBlock]
          .filter(Boolean)
          .join("\n\n");
        const messages = [];
        if (String(systemPrompt).trim())
          messages.push({ role: "system", content: interpolateTemplate(systemPrompt, scope) });
        messages.push({ role: "user", content: userPrompt });

        checkAbort(ctx.signal);
        const llm = await ctx.deps.callLLMOnce({
          baseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          payload: applySampling({ model, messages, temperature: temp }, agent && agent.sampling),
          timeoutMs: perStepTimeout,
          signal: ctx.signal,
        });
        results[id] = { output: llm.content || "" };
        stepSummaries.push({ id, name, model, searched, readFile, chars: (llm.content || "").length });
      }

      // saída final = output do último passo (é o "documento"); intermediários vão pro resumo
      const lastId = String(steps[steps.length - 1].id || "").trim();
      const finalOutput = (results[lastId] && results[lastId].output) || "";
      const markdown = renderPipelineMarkdown({
        title: opts.outputTitle || task.name,
        dateStr,
        steps: stepSummaries,
        finalOutput,
      });
      const dir = String(opts.outputRelDir || "pipelines").replace(/^[\\/]+|[\\/]+$/g, "") || "pipelines";
      const fileRel = `${dir}/pipeline-${dateStr}.md`;
      const { absolute } = ctx.deps.safeWriter.resolveSafeWritePath(opts.outputWriteRoot, fileRel);
      const bytes = await ctx.deps.safeWriter.writeTextFileAtomically(absolute, markdown);

      return {
        fileRel,
        writeRoot: opts.outputWriteRoot,
        bytes,
        stepCount: steps.length,
        steps: stepSummaries,
        model: stepSummaries.map((s) => s.model).join(", "),
        snippet: markdown.slice(0, 400),
        notify: !!opts.notify,
      };
    },
  },

  log_rotation: {
    label: "Rotação de arquivos/logs",
    defaultOptions() {
      return {
        writeRoot: "",
        files: [],
        maxSizeBytes: 5 * 1024 * 1024,
        keep: 5,
        gzip: true,
      };
    },
    validateOptions(opts) {
      const errors = [];
      if (!opts.writeRoot) errors.push("writeRoot obrigatório");
      if (!asStringArray(opts.files).length) errors.push("lista de arquivos vazia");
      return { ok: errors.length === 0, errors };
    },
    async run(task, ctx) {
      const opts = task.options;
      const maxSize = Math.max(1024, Number(opts.maxSizeBytes) || 5 * 1024 * 1024);
      // keep=0 é válido (podar todas as rotações) — não usar `|| 5` (falsy-zero).
      const keepNum = Number(opts.keep);
      const keep = Number.isFinite(keepNum) ? Math.max(0, Math.min(100, keepNum)) : 5;
      const rotated = [];

      for (const rel of asStringArray(opts.files)) {
        checkAbort(ctx.signal);
        const { absolute } = ctx.deps.safeWriter.resolveSafeWritePath(opts.writeRoot, rel);
        let st;
        try {
          st = await fsp.stat(absolute);
        } catch {
          continue; // arquivo ainda não existe
        }
        if (!st.isFile() || st.size <= maxSize) continue;

        const stamp = formatStampInTz(ctx.now, ctx.tz);
        const rotatedAbs = `${absolute}.${stamp}`;
        await fsp.rename(absolute, rotatedAbs);
        await fsp.writeFile(absolute, ""); // trunca/recria o ativo
        if (opts.gzip) {
          await ctx.deps.safeWriter.gzipFileInPlace(rotatedAbs);
          rotated.push(`${path.basename(rotatedAbs)}.gz`);
        } else {
          rotated.push(path.basename(rotatedAbs));
        }
        await pruneRotations(path.dirname(absolute), path.basename(absolute), keep);
      }
      return { rotated, count: rotated.length };
    },
  },

  workspace_backup: {
    label: "Backup de estado do servidor",
    defaultOptions() {
      return {
        backupWriteRoot: "",
        backupRelDir: "backups",
        includeCronState: true,
        sources: [], // [{ writeRoot, relPath }]
        gzip: true,
      };
    },
    validateOptions(opts) {
      const errors = [];
      if (!opts.backupWriteRoot) errors.push("backupWriteRoot obrigatório");
      return { ok: errors.length === 0, errors };
    },
    async run(task, ctx) {
      const opts = task.options;
      const stamp = formatStampInTz(ctx.now, ctx.tz);
      const baseDir = String(opts.backupRelDir || "backups").replace(/^[\\/]+|[\\/]+$/g, "") || "backups";
      const destDir = `${baseDir}/backup-${stamp}`;
      const copied = [];
      const sw = ctx.deps.safeWriter;

      // cron-state.json (caminho server-controlled, contém segredos — documentado)
      if (opts.includeCronState && ctx.stateFilePath) {
        checkAbort(ctx.signal);
        const { absolute: destAbs } = sw.resolveSafeWritePath(opts.backupWriteRoot, `${destDir}/cron-state.json`);
        try {
          await sw.copyFileInto(ctx.stateFilePath, destAbs, { gzip: opts.gzip });
          copied.push("cron-state.json");
        } catch (e) {
          ctx.log && ctx.log.warn && ctx.log.warn(`[cron] backup cron-state falhou: ${e.message}`);
        }
      }

      for (const src of Array.isArray(opts.sources) ? opts.sources : []) {
        checkAbort(ctx.signal);
        if (!src || !src.writeRoot || !src.relPath) continue;
        const { absolute: srcAbs } = sw.resolveSafeWritePath(src.writeRoot, src.relPath);
        let st;
        try {
          st = await fsp.stat(srcAbs);
        } catch {
          continue;
        }
        if (!st.isFile()) continue; // diretórios fora de escopo (mantém simples/zero-dep)
        const { absolute: destAbs } = sw.resolveSafeWritePath(opts.backupWriteRoot, `${destDir}/${path.basename(srcAbs)}`);
        await sw.copyFileInto(srcAbs, destAbs, { gzip: opts.gzip });
        copied.push(path.basename(srcAbs));
      }
      return { destDir, writeRoot: opts.backupWriteRoot, copied, count: copied.length };
    },
  },
};

async function pruneRotations(dir, baseName, keep) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  const prefix = `${baseName}.`;
  const rotations = names.filter((n) => n.startsWith(prefix) && n !== baseName).sort(); // timestamp asc no nome
  const excess = rotations.length - keep;
  for (let i = 0; i < excess; i++) {
    try {
      await fsp.unlink(path.join(dir, rotations[i]));
    } catch {}
  }
}

/* ---------- factory do motor ---------- */

function createCronEngine(opts = {}) {
  const enabled = !!opts.enabled;
  const stateFilePath = opts.stateFilePath || null;
  const seedFilePath = opts.seedFilePath || null;
  const defaultTz = opts.defaultTz || "UTC";
  const maxTimeoutMs = opts.maxTimeoutMs || 120_000;
  const maxFailures = opts.maxFailures || 5;
  const tickMs = opts.tickMs == null ? DEFAULT_TICK_MS : opts.tickMs;
  const now = opts.now || (() => Date.now());
  const log = opts.log || console;
  const taskDeps = opts.taskDeps || {};
  const registry = Object.assign({}, TASK_REGISTRY, opts.registryOverride || {});
  const setIntervalImpl = opts.setIntervalImpl || setInterval;
  const clearIntervalImpl = opts.clearIntervalImpl || clearInterval;
  const setTimeoutImpl = opts.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = opts.clearTimeoutImpl || clearTimeout;

  let S = emptyState();
  let interval = null;
  let persistTimer = null;
  let persistSeq = 0;

  function emptyState() {
    return { version: 1, connections: [], agents: [], tasks: [], history: {} };
  }

  function freshState() {
    return {
      lastRunAt: null,
      lastFinishAt: null,
      nextRunAt: null,
      lastStatus: null,
      lastError: null,
      running: false,
      consecutiveFailures: 0,
      scheduleError: null,
    };
  }

  function ensureTaskShape(t) {
    if (!t.state || typeof t.state !== "object") t.state = freshState();
    else t.state = Object.assign(freshState(), t.state);
    if (!t.policy || typeof t.policy !== "object") t.policy = normalizePolicy({});
    if (!t.schedule || typeof t.schedule !== "object") t.schedule = { kind: "cron", cron: "0 8 * * *", tz: defaultTz };
    if (!t.options || typeof t.options !== "object") t.options = {};
  }

  function sanitizeState(obj) {
    const s = emptyState();
    if (obj && Array.isArray(obj.connections)) s.connections = obj.connections;
    if (obj && Array.isArray(obj.agents)) s.agents = obj.agents;
    if (obj && Array.isArray(obj.tasks)) s.tasks = obj.tasks;
    if (obj && obj.history && typeof obj.history === "object") s.history = obj.history;
    for (const t of s.tasks) ensureTaskShape(t);
    return s;
  }

  async function loadState() {
    if (!stateFilePath) {
      if (opts.initialState) S = sanitizeState(opts.initialState);
      return S;
    }
    try {
      const raw = await fsp.readFile(stateFilePath, "utf8");
      S = sanitizeState(JSON.parse(raw));
      return S;
    } catch {
      // arquivo ausente → seed (sem persistir ainda; só grava na 1ª mutação)
      S = await seedState();
      return S;
    }
  }

  async function seedState() {
    if (seedFilePath) {
      try {
        const raw = await fsp.readFile(seedFilePath, "utf8");
        log.log && log.log(`[cron] semeando estado de ${seedFilePath}`);
        return sanitizeState(JSON.parse(raw));
      } catch (e) {
        log.warn && log.warn(`[cron] seed falhou (${e.message}); iniciando vazio`);
      }
    }
    return emptyState();
  }

  function schedulePersist() {
    if (!stateFilePath) return;
    if (persistTimer) return;
    persistTimer = setTimeoutImpl(() => {
      persistTimer = null;
      persistNow().catch((e) => log.error && log.error(`[cron] persist falhou: ${e.message}`));
    }, PERSIST_DEBOUNCE_MS);
    if (persistTimer && persistTimer.unref) persistTimer.unref();
  }

  async function persistNow() {
    if (!stateFilePath) return;
    await fsp.mkdir(path.dirname(stateFilePath), { recursive: true });
    // Nome de tmp único por chamada — duas persistNow sobrepostas (disco lento)
    // não podem colidir no mesmo arquivo temporário e corromper o estado.
    const tmp = `${stateFilePath}.tmp-${process.pid}-${++persistSeq}`;
    await fsp.writeFile(tmp, JSON.stringify(S, null, 2));
    await fsp.rename(tmp, stateFilePath);
  }

  /* ----- conexões ----- */

  function resolveConnection(connectionId) {
    const c = S.connections.find((x) => x.id === connectionId);
    if (!c) return null;
    let apiKey = "";
    if (c.apiKeyEnv) apiKey = process.env[c.apiKeyEnv] || "";
    else if (typeof c.apiKey === "string") apiKey = c.apiKey;
    return { baseUrl: c.baseUrl, apiKey, model: c.model };
  }

  function redactConnection(c) {
    return {
      id: c.id,
      nickname: c.nickname,
      baseUrl: c.baseUrl,
      model: c.model,
      apiKeyEnv: c.apiKeyEnv || null,
      hasApiKey: !!(c.apiKey || c.apiKeyEnv),
      sourceServerId: c.sourceServerId || null, // se espelhada de um servidor de chat
    };
  }

  function upsertConnection(input) {
    const existing = input.id ? S.connections.find((c) => c.id === input.id) : null;
    const conn = existing || { id: crypto.randomUUID() };
    conn.nickname = String(input.nickname || "").trim() || "Conexão";
    conn.baseUrl = String(input.baseUrl || "").trim();
    conn.model = String(input.model || "").trim();
    conn.apiKeyEnv = input.apiKeyEnv ? String(input.apiKeyEnv).trim() : null;
    if (input.sourceServerId !== undefined) conn.sourceServerId = input.sourceServerId || null;
    // Sentinela "***" = manter a chave existente (a UI nunca recebe o segredo de volta).
    if (input.apiKey === "***") {
      if (!existing) conn.apiKey = "";
    } else {
      conn.apiKey = typeof input.apiKey === "string" ? input.apiKey : conn.apiKey || "";
    }
    if (!existing) S.connections.push(conn);
    schedulePersist();
    return redactConnection(conn);
  }

  function deleteConnection(id) {
    S.connections = S.connections.filter((c) => c.id !== id);
    schedulePersist();
    return { ok: true };
  }

  /* ----- agentes reutilizáveis (skills) ----- */

  function resolveAgent(agentId) {
    return S.agents.find((a) => a.id === agentId) || null;
  }

  // Agentes não guardam segredo (referenciam uma conexão), então o estado público é o
  // próprio objeto — só normalizado. Mantido como função pra simetria com conexões.
  function publicAgent(a) {
    return JSON.parse(JSON.stringify(a));
  }

  function normalizeAgentTools(tools) {
    const t = tools || {};
    const ws = t.webSearch || {};
    const fr = t.fileRead || {};
    return {
      webSearch: { enabled: !!ws.enabled, query: String(ws.query || ""), maxResults: Number(ws.maxResults) || 5 },
      fileRead: { enabled: !!fr.enabled, sourceRoot: String(fr.sourceRoot || ""), relPath: String(fr.relPath || "") },
    };
  }

  function upsertAgent(input) {
    const existing = input.id ? S.agents.find((a) => a.id === input.id) : null;
    const agent = existing || { id: crypto.randomUUID() };
    agent.name = String(input.name || "").trim() || "Agente";
    agent.connectionId = String(input.connectionId || "").trim();
    agent.model = String(input.model || "").trim();
    agent.systemPrompt = String(input.systemPrompt || "");
    agent.defaultPrompt = String(input.defaultPrompt || "");
    const temp = Number(input.temperature);
    agent.temperature = Number.isFinite(temp) ? temp : 0.3;
    agent.tools = normalizeAgentTools(input.tools);
    if (input.sourceProfileId !== undefined) agent.sourceProfileId = input.sourceProfileId || null;
    // sampling extra (top_p/max_tokens/stop…) opcional, espelhado do perfil de chat
    if (input.sampling && typeof input.sampling === "object") agent.sampling = input.sampling;
    else if (input.sampling === null) agent.sampling = null;
    if (!existing) S.agents.push(agent);
    schedulePersist();
    return publicAgent(agent);
  }

  function deleteAgent(id) {
    S.agents = S.agents.filter((a) => a.id !== id);
    schedulePersist();
    return { ok: true };
  }

  /* ----- tarefas ----- */

  function normalizePolicy(p) {
    p = p || {};
    const clamp = (v, lo, hi, def) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(hi, Math.max(lo, n));
    };
    return {
      catchUpOnStart: !!p.catchUpOnStart,
      overlap: "skip",
      timeoutMs: clamp(p.timeoutMs, 1000, maxTimeoutMs, Math.min(120_000, maxTimeoutMs)),
      jitterMs: clamp(p.jitterMs, 0, 300_000, 0),
    };
  }

  function normalizeSchedule(schedule, cron) {
    const s = schedule || {};
    return {
      kind: s.kind === "preset" ? "preset" : "cron",
      preset: s.kind === "preset" ? s.preset : null,
      cron,
      tz: s.tz || defaultTz,
    };
  }

  function recomputeNextRun(task, fromMs) {
    try {
      const parsed = parseCron(resolveCron(task.schedule));
      const base = Math.max(fromMs, task.state.lastRunAt || 0);
      const next = nextRunAfter(parsed, new Date(base), task.schedule.tz || defaultTz);
      if (next) {
        task.state.nextRunAt = next.getTime();
        task.state.scheduleError = null;
      } else {
        // Expressão válida mas sem ocorrência no horizonte (366 dias) — ex: um
        // "0 0 29 2 *" criado fora de ano bissexto. Não deixar silenciosamente morta.
        task.state.nextRunAt = null;
        task.state.scheduleError = "agenda sem próxima execução nos próximos 366 dias";
      }
    } catch (e) {
      task.state.nextRunAt = null;
      task.state.scheduleError = e.message;
    }
  }

  function publicTask(task) {
    return JSON.parse(JSON.stringify(task));
  }

  function upsertTask(input) {
    const reg = registry[input.type];
    if (!reg) throw new Error(`tipo de tarefa desconhecido: ${input.type}`);
    const cron = resolveCron(input.schedule); // lança se inválido
    // Rejeita timezone inválido no save (senão partsInTz cairia pra UTC
    // silenciosamente e a tarefa rodaria no horário errado pra sempre).
    const tz = input.schedule && input.schedule.tz;
    if (tz && !isValidTimeZone(tz)) throw new Error(`timezone inválido: "${tz}"`);
    const v = reg.validateOptions(Object.assign({}, reg.defaultOptions(), input.options || {}));
    if (!v.ok) throw new Error(`opções inválidas: ${v.errors.join("; ")}`);

    const existing = input.id ? S.tasks.find((t) => t.id === input.id) : null;
    const task = existing || { id: crypto.randomUUID(), state: freshState() };
    task.type = input.type;
    task.name = String(input.name || "").trim() || reg.label;
    task.enabled = !!input.enabled;
    task.schedule = normalizeSchedule(input.schedule, cron);
    task.options = Object.assign(reg.defaultOptions(), input.options || {});
    task.policy = normalizePolicy(input.policy);
    if (!existing) S.tasks.push(task);
    recomputeNextRun(task, now());
    schedulePersist();
    return publicTask(task);
  }

  function deleteTask(id) {
    S.tasks = S.tasks.filter((t) => t.id !== id);
    delete S.history[id];
    schedulePersist();
    return { ok: true };
  }

  function getHistory(id) {
    return S.history[id] || [];
  }

  function pushHistory(id, record) {
    const list = S.history[id] || [];
    list.unshift(record);
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    S.history[id] = list;
  }

  async function getResult(id, runId) {
    const hist = getHistory(id);
    const rec = (runId && hist.find((r) => r.runId === runId)) || hist[0];
    if (!rec) throw new Error("nenhuma execução registrada.");
    const sum = rec.summary;
    if (!sum || !sum.fileRel || !sum.writeRoot) {
      return { content: null, status: rec.status, error: rec.error, summary: sum || null };
    }
    const { absolute } = taskDeps.safeWriter.resolveSafeWritePath(sum.writeRoot, sum.fileRel);
    const content = await fsp.readFile(absolute, "utf8");
    return { content, fileRel: sum.fileRel, status: rec.status };
  }

  /* ----- execução ----- */

  async function runTask(task, nowMs) {
    const at = nowMs == null ? now() : nowMs;
    const reg = registry[task.type];
    const runId = crypto.randomUUID();
    if (!reg) {
      pushHistory(task.id, { runId, startedAt: at, finishedAt: at, status: "error", error: `tipo desconhecido: ${task.type}`, summary: null });
      task.state.lastStatus = "error";
      return { runId, status: "error" };
    }
    task.state.running = true;
    task.state.lastRunAt = at;
    task.state.lastStatus = "running";
    schedulePersist();

    const ac = new AbortController();
    const cap = Math.min(task.policy && task.policy.timeoutMs ? task.policy.timeoutMs : maxTimeoutMs, maxTimeoutMs);
    const killer = setTimeoutImpl(() => ac.abort(), cap);

    let status = "ok";
    let error = null;
    let summary = null;
    try {
      summary = await reg.run(task, {
        signal: ac.signal,
        now: at,
        tz: (task.schedule && task.schedule.tz) || defaultTz,
        timeoutMs: cap,
        deps: taskDeps,
        resolveConnection,
        resolveAgent,
        getHistory,
        stateFilePath,
        log,
      });
      task.state.consecutiveFailures = 0;
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || /timeout|abort/i.test(e.message || ""));
      status = aborted ? "timeout" : "error";
      error = e ? e.message || String(e) : "erro desconhecido";
      task.state.consecutiveFailures = (task.state.consecutiveFailures || 0) + 1;
      if (task.state.consecutiveFailures >= maxFailures) {
        task.enabled = false;
        log.warn && log.warn(`[cron] tarefa "${task.name}" desabilitada após ${maxFailures} falhas consecutivas`);
      }
    } finally {
      clearTimeoutImpl(killer);
      task.state.running = false;
      task.state.lastFinishAt = now();
      task.state.lastStatus = status;
      task.state.lastError = error;
      pushHistory(task.id, { runId, startedAt: at, finishedAt: task.state.lastFinishAt, status, error, summary });
      schedulePersist();
    }
    return { runId, status, error, summary };
  }

  /** Um passo do scheduler. Retorna descritores do que decidiu (útil pra teste). */
  function tick(nowMs) {
    const at = nowMs == null ? now() : nowMs;
    const decisions = [];
    if (!enabled) return decisions;
    for (const task of S.tasks) {
      if (!task.enabled) {
        decisions.push({ taskId: task.id, action: "skip-disabled" });
        continue;
      }
      if (task.state.running) {
        decisions.push({ taskId: task.id, action: "skip-running" });
        continue;
      }
      if (task.state.nextRunAt == null) {
        decisions.push({ taskId: task.id, action: "skip-no-schedule" });
        continue;
      }
      if (at < task.state.nextRunAt) {
        decisions.push({ taskId: task.id, action: "skip-not-due" });
        continue;
      }
      // due → reivindica (running=true em runTask), agenda e avança nextRunAt já
      const jitter = task.policy && task.policy.jitterMs ? task.policy.jitterMs : 0;
      if (jitter > 0) {
        task.state.running = true; // reivindica pra não re-agendar no próximo tick
        const delay = deterministicJitter(task.id, task.state.nextRunAt, jitter);
        setTimeoutImpl(() => {
          task.state.running = false; // runTask seta de novo; evita travar se runTask falhar antes
          runTask(task, at);
        }, delay);
      } else {
        runTask(task, at);
      }
      recomputeNextRun(task, at);
      decisions.push({ taskId: task.id, action: "run" });
    }
    return decisions;
  }

  function deterministicJitter(id, slot, jitterMs) {
    const h = crypto.createHash("sha256").update(`${id}:${slot}`).digest();
    const n = h.readUInt32BE(0);
    return n % jitterMs;
  }

  function runNow(id) {
    const task = S.tasks.find((t) => t.id === id);
    if (!task) throw new Error("tarefa não encontrada.");
    if (task.state.running) return { started: false, reason: "já em execução" };
    runTask(task, now()).catch((e) => log.error && log.error(`[cron] runNow erro: ${e.message}`));
    return { started: true };
  }

  function getPublicState() {
    return {
      enabled,
      stateFile: stateFilePath ? path.basename(stateFilePath) : null,
      writeRoots: taskDeps.safeWriter ? taskDeps.safeWriter.getWriteRoots() : [],
      workspaceRoots: taskDeps.safeReader && taskDeps.safeReader.getReadRoots ? taskDeps.safeReader.getReadRoots() : [],
      connections: S.connections.map(redactConnection),
      agents: S.agents.map(publicAgent),
      tasks: S.tasks.map(publicTask),
      registry: Object.keys(registry).map((type) => ({
        type,
        label: registry[type].label,
        defaultOptions: registry[type].defaultOptions(),
      })),
    };
  }

  async function start() {
    await loadState();
    for (const t of S.tasks) {
      ensureTaskShape(t);
      t.state.running = false; // limpa "running" órfão de crash mid-run
      recomputeNextRun(t, now());
    }
    // catch-up: roda 1x as tarefas que perderam um horário enquanto estávamos offline
    for (const t of S.tasks) {
      if (!t.enabled || !t.policy || !t.policy.catchUpOnStart || t.state.lastRunAt == null) continue;
      try {
        const parsed = parseCron(resolveCron(t.schedule));
        const missed = nextRunAfter(parsed, new Date(t.state.lastRunAt), t.schedule.tz || defaultTz);
        if (missed && missed.getTime() <= now()) {
          log.log && log.log(`[cron] catch-up: executando "${t.name}" (perdeu agendamento durante downtime)`);
          runTask(t, now());
        }
      } catch {}
    }
    if (enabled && tickMs > 0) {
      interval = setIntervalImpl(() => tick(now()), tickMs);
      if (interval && interval.unref) interval.unref();
      tick(now());
    }
    return S;
  }

  function stop() {
    if (interval) clearIntervalImpl(interval);
    interval = null;
  }

  return {
    start,
    stop,
    tick,
    runTask,
    runNow,
    recomputeNextRun,
    getPublicState,
    upsertTask,
    deleteTask,
    getHistory,
    getResult,
    upsertConnection,
    deleteConnection,
    resolveConnection,
    upsertAgent,
    deleteAgent,
    resolveAgent,
    persistNow,
    // helpers de teste
    _state: () => S,
    _setState: (obj) => {
      S = sanitizeState(obj);
      return S;
    },
    _registry: registry,
  };
}

module.exports = {
  createCronEngine,
  TASK_REGISTRY,
  buildDigestPrompt,
  renderDigestMarkdown,
  interpolateTemplate,
  buildSearchBlock,
  buildPriorContext,
  applySampling,
  renderPipelineMarkdown,
  formatDateInTz,
  formatStampInTz,
  DEFAULT_DIGEST_SYSTEM,
};
