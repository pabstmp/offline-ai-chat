/**
 * Cron Engine — Test Suite
 * Run: node tests/cron.test.js
 * Mesmo estilo das outras suites: assert plano + fast-check, createRequire pros
 * módulos CommonJS de server-lib/.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import fc from "fast-check";

const require = createRequire(import.meta.url);
const { parseCron, cronMatches, nextRunAfter, presetToCron, resolveCron, isValidTimeZone } = require("../server-lib/cron-expr.js");
const { createSafeWriter } = require("../server-lib/safe-write.js");
const {
  createCronEngine, buildDigestPrompt, renderDigestMarkdown, formatDateInTz,
} = require("../server-lib/cron-engine.js");

let passed = 0;
let failed = 0;
const pending = []; // promessas de todos os test() — aguardadas antes do resumo

function section(title) { console.log(`\n── ${title} ──`); }
function test(label, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => { passed++; console.log(`  ✓ ${label}`); })
      .catch((err) => { failed++; console.error(`  ✗ ${label}\n    ${err.message}`); })
  );
}
function runProperty(label, prop, opts = {}) {
  try { fc.assert(prop, { numRuns: 100, ...opts }); passed++; console.log(`  ✓ [PBT] ${label}`); }
  catch (err) { failed++; console.error(`  ✗ [PBT] ${label}\n    ${err.message}`); }
}

/* ───────────────────────── cron-expr ───────────────────────── */
section("cron-expr — parseCron / presets");
test("presets compilam pra cron padrão", () => {
  assert.equal(presetToCron({ kind: "daily", time: "08:30" }), "30 8 * * *");
  assert.equal(presetToCron({ kind: "weekly", time: "09:00", weekday: 1 }), "0 9 * * 1");
  assert.equal(presetToCron({ kind: "hourly", minute: 15 }), "15 * * * *");
});
test("parseCron aceita *, */n, ranges, listas", () => {
  assert.ok(parseCron("*/15 * * * *"));
  assert.ok(parseCron("0 9-17 * * 1-5"));
  assert.ok(parseCron("0,30 8 1,15 * *"));
});
test("parseCron rejeita malformado / fora de range", () => {
  assert.throws(() => parseCron("60 * * * *"));
  assert.throws(() => parseCron("* * * *"));
  assert.throws(() => parseCron("* * * * 9"));
  assert.throws(() => parseCron("a b c d e"));
});
test("resolveCron compila preset e valida cron cru", () => {
  assert.equal(resolveCron({ kind: "preset", preset: { kind: "daily", time: "08:00" } }), "0 8 * * *");
  assert.equal(resolveCron({ kind: "cron", cron: "0 8 * * *" }), "0 8 * * *");
  assert.throws(() => resolveCron({ kind: "cron", cron: "99 * * * *" }));
});

section("cron-expr — cronMatches / nextRunAfter / timezone");
test("cronMatches casa minuto/hora exatos (UTC)", () => {
  const p = parseCron("30 8 * * *");
  assert.equal(cronMatches(p, new Date("2026-05-30T08:30:00Z"), "UTC"), true);
  assert.equal(cronMatches(p, new Date("2026-05-30T08:31:00Z"), "UTC"), false);
});
test("DOM e DOW restritos casam por OR (semântica Vixie)", () => {
  const p = parseCron("0 0 1 * 1"); // dia 1 OU segunda-feira
  assert.equal(cronMatches(p, new Date("2026-06-01T00:00:00Z"), "UTC"), true);  // dia 1 (e segunda)
  assert.equal(cronMatches(p, new Date("2026-06-08T00:00:00Z"), "UTC"), true);  // segunda
  assert.equal(cronMatches(p, new Date("2026-06-09T00:00:00Z"), "UTC"), false); // terça, dia 9
});
test("nextRunAfter é estritamente futuro e casa", () => {
  const p = parseCron("30 8 * * *");
  const from = new Date("2026-05-30T08:30:00Z");
  const n = nextRunAfter(p, from, "UTC");
  assert.ok(n.getTime() > from.getTime());
  assert.equal(cronMatches(p, n, "UTC"), true);
  assert.equal(n.toISOString(), "2026-05-31T08:30:00.000Z");
});
test("timezone: 8h America/Sao_Paulo = 11h UTC", () => {
  const p = parseCron("0 8 * * *");
  const n = nextRunAfter(p, new Date("2026-05-30T00:00:00Z"), "America/Sao_Paulo");
  assert.equal(n.toISOString(), "2026-05-30T11:00:00.000Z");
});
runProperty("nextRunAfter sempre casa e é futuro", fc.property(
  fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 1e12 }),
  (min, hour, fromMs) => {
    const p = parseCron(`${min} ${hour} * * *`);
    const from = new Date(fromMs);
    const n = nextRunAfter(p, from, "UTC");
    return n != null && n.getTime() > from.getTime() && cronMatches(p, n, "UTC");
  }
));

/* ───────────────────────── safe-write ───────────────────────── */
section("safe-write — guard de escrita");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cron-sw-"));
  const sw = createSafeWriter({ writeRoots: [tmp], maxWriteBytes: 1024 });

  test("escreve dentro do root (atômico)", async () => {
    const { absolute } = sw.resolveSafeWritePath(tmp, "sub/a.md");
    await sw.writeTextFileAtomically(absolute, "olá");
    assert.equal(fs.readFileSync(absolute, "utf8"), "olá");
  });
  test("bloqueia traversal ../", () => {
    assert.throws(() => sw.resolveSafeWritePath(tmp, "../escape.txt"), /relPath inválido|fora/);
  });
  test("bloqueia path absoluto", () => {
    assert.throws(() => sw.resolveSafeWritePath(tmp, path.resolve(os.tmpdir(), "x.txt")), /relPath inválido/);
  });
  test("bloqueia writeRoot fora da whitelist", () => {
    assert.throws(() => sw.resolveSafeWritePath(os.tmpdir(), "x.txt"), /não está autorizado/);
  });
  test("rejeita conteúdo acima de maxWriteBytes", async () => {
    const { absolute } = sw.resolveSafeWritePath(tmp, "big.txt");
    await assert.rejects(() => sw.writeTextFileAtomically(absolute, "x".repeat(2000)), /excede/);
  });
  test("fail-closed: sem write-roots, qualquer escrita lança", () => {
    const closed = createSafeWriter({ writeRoots: [] });
    assert.throws(() => closed.resolveSafeWritePath(tmp, "a.txt"), /não configurado/);
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

/* ───────────────────────── cron-engine scheduler ───────────────────────── */
section("cron-engine — scheduler");

function mkEngine(extra = {}) {
  return createCronEngine(Object.assign({
    enabled: true, stateFilePath: null, defaultTz: "UTC", maxTimeoutMs: 5000, maxFailures: 2,
    tickMs: 0, now: () => 1000,
  }, extra));
}
function mkTask(type, over = {}) {
  return Object.assign({
    id: "t1", type, name: "T", enabled: true,
    schedule: { kind: "cron", cron: "* * * * *", tz: "UTC" }, options: {},
    policy: { overlap: "skip", timeoutMs: 5000, jitterMs: 0, catchUpOnStart: false },
    state: { nextRunAt: 500, running: false, lastRunAt: null, consecutiveFailures: 0 },
  }, over);
}

test("tarefa due dispara (action=run)", async () => {
  let ran = 0;
  const e = mkEngine({ registryOverride: { ok: { label: "ok", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }), run: async () => { ran++; return {}; } } } });
  e._setState({ tasks: [mkTask("ok")] });
  const dec = e.tick(1000);
  assert.equal(dec[0].action, "run");
  await new Promise((r) => setImmediate(r));
  assert.equal(ran, 1);
});
test("overlap-guard pula tarefa em execução", () => {
  const e = mkEngine({ registryOverride: { ok: { label: "ok", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }), run: async () => ({}) } } });
  e._setState({ tasks: [mkTask("ok", { state: { nextRunAt: 500, running: true } })] });
  assert.equal(e.tick(1000)[0].action, "skip-running");
});
test("não-due é pulado", () => {
  const e = mkEngine({ registryOverride: { ok: { label: "ok", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }), run: async () => ({}) } } });
  e._setState({ tasks: [mkTask("ok", { state: { nextRunAt: 9e15, running: false } })] });
  assert.equal(e.tick(1000)[0].action, "skip-not-due");
});
test("timeout aborta e marca status=timeout", async () => {
  const e = mkEngine({ registryOverride: { slow: { label: "slow", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }),
    run: (task, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => { const x = new Error("ab"); x.name = "AbortError"; rej(x); })) } } });
  e._setState({ tasks: [mkTask("slow", { policy: { timeoutMs: 40, jitterMs: 0 } })] });
  const r = await e.runTask(e._state().tasks[0], 1000);
  assert.equal(r.status, "timeout");
});
test("disjuntor desabilita após N falhas consecutivas", async () => {
  const e = mkEngine({ maxFailures: 2, registryOverride: { fail: { label: "fail", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }), run: async () => { throw new Error("boom"); } } } });
  e._setState({ tasks: [mkTask("fail")] });
  const t = e._state().tasks[0];
  await e.runTask(t, 1000); assert.equal(t.enabled, true);
  await e.runTask(t, 1000); assert.equal(t.enabled, false);
  assert.equal(e.getHistory("t1").length, 2);
});
test("recomputeNextRun é monotônico (avança)", () => {
  const e = mkEngine();
  const t = mkTask("ok", { schedule: { kind: "cron", cron: "0 8 * * *", tz: "UTC" }, state: { lastRunAt: Date.parse("2026-05-30T08:00:00Z"), running: false } });
  e.recomputeNextRun(t, Date.parse("2026-05-30T09:00:00Z"));
  assert.equal(new Date(t.state.nextRunAt).toISOString(), "2026-05-31T08:00:00.000Z");
});
test("catch-up roda 1x quando perdeu horário durante downtime", async () => {
  let ran = 0;
  const NOW = Date.parse("2026-05-30T09:00:00Z");
  const e = mkEngine({
    now: () => NOW, tickMs: 0,
    registryOverride: { ok: { label: "ok", defaultOptions: () => ({}), validateOptions: () => ({ ok: true, errors: [] }), run: async () => { ran++; return {}; } } },
    initialState: { tasks: [mkTask("ok", {
      schedule: { kind: "cron", cron: "0 8 * * *", tz: "UTC" },
      policy: { catchUpOnStart: true, timeoutMs: 5000, jitterMs: 0 },
      state: { lastRunAt: Date.parse("2026-05-29T08:00:00Z"), running: false, consecutiveFailures: 0 },
    })] },
  });
  await e.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(ran, 1, "deveria rodar exatamente 1x no catch-up");
  e.stop();
});
test("upsert valida cron e tipo; redação esconde apiKey", () => {
  const e = mkEngine();
  assert.throws(() => e.upsertTask({ type: "inexistente", schedule: { kind: "cron", cron: "0 8 * * *" }, options: {} }), /desconhecido/);
  const conn = e.upsertConnection({ nickname: "C", baseUrl: "http://localhost:1234/v1", apiKey: "secret" });
  assert.equal(conn.apiKey, undefined);
  assert.equal(conn.hasApiKey, true);
  const pub = e.getPublicState();
  assert.equal(pub.connections[0].apiKey, undefined);
  // sentinela "***" mantém a chave
  e.upsertConnection({ id: conn.id, nickname: "C2", baseUrl: "http://localhost:1234/v1", apiKey: "***" });
  assert.equal(e.resolveConnection(conn.id).apiKey, "secret");
});

/* ───────────────────────── digest helpers (puros) ───────────────────────── */
section("digest — helpers puros");
test("buildDigestPrompt inclui todas as queries e resultados", () => {
  const groups = [
    { query: "ia", results: [{ title: "T1", url: "http://a", snippet: "s1" }] },
    { query: "ml", results: [{ title: "T2", url: "http://b", snippet: "s2", isNew: true }] },
  ];
  const p = buildDigestPrompt(groups);
  assert.ok(p.includes("ia") && p.includes("ml"));
  assert.ok(p.includes("http://a") && p.includes("http://b"));
  assert.ok(p.includes("[NOVO]"));
});
test("renderDigestMarkdown gera markdown datado e linkado", () => {
  const md = renderDigestMarkdown({ title: "Boletim", dateStr: "2026-05-30", summary: "resumo", groups: [
    { query: "ia", results: [{ title: "T1", url: "http://a", snippet: "s1", isNew: true }] },
  ] });
  assert.ok(md.startsWith("# Boletim"));
  assert.ok(md.includes("2026-05-30"));
  assert.ok(md.includes("[T1](http://a)"));
  assert.ok(md.includes("**(novo)**"));
});
test("formatDateInTz respeita timezone", () => {
  // 2026-05-30T02:00:00Z é ainda 2026-05-29 23h em São Paulo (UTC-3)
  assert.equal(formatDateInTz(Date.parse("2026-05-30T02:00:00Z"), "America/Sao_Paulo"), "2026-05-29");
  assert.equal(formatDateInTz(Date.parse("2026-05-30T02:00:00Z"), "UTC"), "2026-05-30");
});

/* ───────────────────────── regressões (code-review) ───────────────────────── */
section("regressões — bugs corrigidos no review");

test("#1 DOW com 7: ranges 1-7/5-7/0-7 e literal 7 expandem certo", () => {
  assert.deepEqual([...parseCron("0 0 * * 1-7").dow].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...parseCron("0 0 * * 5-7").dow].sort((a, b) => a - b), [0, 5, 6]);
  assert.deepEqual([...parseCron("0 0 * * 0-7").dow].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...parseCron("0 0 * * 7").dow], [0]);
  // 1-7 deve casar qualquer dia da semana
  assert.equal(cronMatches(parseCron("0 0 * * 1-7"), new Date("2026-06-09T00:00:00Z"), "UTC"), true);
});
test("#4 parseField rejeita tokens negativos/vazios/malformados", () => {
  for (const bad of ["-5 * * * *", "5- * * * *", ". * * * *", "1-x * * * *"]) {
    assert.throws(() => parseCron(bad), undefined, `deveria rejeitar "${bad}"`);
  }
});
test("#3 isValidTimeZone + upsert rejeita tz inválido", () => {
  assert.equal(isValidTimeZone("America/Sao_Paulo"), true);
  assert.equal(isValidTimeZone(""), true);
  assert.equal(isValidTimeZone("America/Nao_Existe"), false);
  const e = mkEngine();
  assert.throws(() => e.upsertTask({
    type: "log_rotation", name: "x",
    schedule: { kind: "cron", cron: "0 8 * * *", tz: "America/Nao_Existe" },
    options: { writeRoot: "/tmp", files: ["a.log"] },
  }), /timezone inválido/);
});
test("#5 agenda válida sem próxima execução marca scheduleError", () => {
  const e = mkEngine();
  const t = mkTask("ok", { schedule: { kind: "cron", cron: "0 0 30 2 *", tz: "UTC" }, state: {} });
  e.recomputeNextRun(t, Date.parse("2026-05-30T00:00:00Z"));
  assert.equal(t.state.nextRunAt, null);
  assert.match(t.state.scheduleError || "", /sem próxima execução/);
});
test("#2 log_rotation respeita keep=0 (poda todas as rotações)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cron-rot-"));
  const sw = createSafeWriter({ writeRoots: [tmp], maxWriteBytes: 10 * 1024 * 1024 });
  const e = createCronEngine({
    enabled: true, stateFilePath: null, tickMs: 0,
    now: () => Date.parse("2026-05-30T12:00:00Z"), taskDeps: { safeWriter: sw },
  });
  fs.writeFileSync(path.join(tmp, "app.log"), "x".repeat(2048));
  e.upsertTask({
    type: "log_rotation", name: "rot", enabled: true,
    schedule: { kind: "cron", cron: "* * * * *", tz: "UTC" },
    options: { writeRoot: tmp, files: ["app.log"], maxSizeBytes: 1024, keep: 0, gzip: false },
  });
  const r = await e.runTask(e._state().tasks[0], Date.parse("2026-05-30T12:00:00Z"));
  assert.equal(r.status, "ok", JSON.stringify(r));
  const rotations = fs.readdirSync(tmp).filter((n) => n.startsWith("app.log.") && n !== "app.log");
  assert.equal(rotations.length, 0, "keep=0 deve podar todas as rotações");
  assert.ok(fs.existsSync(path.join(tmp, "app.log")), "arquivo ativo recriado vazio");
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

/* ───────────────────────── resumo ─────────────────────────
   Aguarda TODOS os test() (inclusive os async) antes de imprimir — assim um
   teste assíncrono que falha não passa despercebido (não há mais corrida com
   um setTimeout fixo). */
Promise.allSettled(pending).then(() => {
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
