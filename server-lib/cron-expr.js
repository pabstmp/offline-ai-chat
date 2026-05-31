/* server-lib/cron-expr.js — parser + avaliador de cron (5 campos), zero-dep.
 *
 * Suporta a sintaxe Vixie padrão para os campos:
 *   minuto(0-59) hora(0-23) dia-do-mês(1-31) mês(1-12) dia-da-semana(0-6, 0=domingo, 7=domingo)
 * Cada campo aceita: estrela, passo (estrela-barra-n), ranges (a-b), ranges com
 * passo (a-b/n), listas (a,b,c) e número literal.
 *
 * A avaliação é feita num timezone IANA (via Intl.DateTimeFormat, built-in no Node),
 * então "todo dia 8h" fica correto mesmo com DST e mesmo que o servidor rode em UTC.
 *
 * Semântica de DOM/DOW (igual cron clássico): se AMBOS dia-do-mês e dia-da-semana
 * estão restritos (≠ `*`), o match é o OR dos dois. Se só um está restrito, vale ele.
 */
"use strict";

const FIELD_BOUNDS = [
  { name: "minuto", min: 0, max: 59 },
  { name: "hora", min: 0, max: 23 },
  { name: "dia-do-mês", min: 1, max: 31 },
  { name: "mês", min: 1, max: 12 },
  { name: "dia-da-semana", min: 0, max: 6 },
];

function parseField(raw, idx) {
  const { name, min, max } = FIELD_BOUNDS[idx];
  const set = new Set();
  const token = String(raw).trim();
  if (!token) throw new Error(`campo cron "${name}" vazio`);

  for (const part of token.split(",")) {
    const piece = part.trim();
    if (!piece) throw new Error(`lista cron inválida no campo "${name}"`);

    let step = 1;
    let rangePart = piece;
    const slash = piece.indexOf("/");
    if (slash >= 0) {
      rangePart = piece.slice(0, slash);
      step = Number(piece.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(`step inválido "${piece}" no campo "${name}"`);
      }
    }

    // dia-da-semana aceita 7 como domingo: o range válido de entrada é 0-7;
    // cada valor é mapeado com `% 7` na expansão (7→0), DEPOIS da checagem de
    // range — senão "1-7"/"0-7" quebrariam ou colapsariam pra um único dia.
    const inMax = idx === 4 ? 7 : max;

    let lo;
    let hi;
    if (rangePart === "*") {
      lo = min;
      hi = inMax;
    } else if (rangePart.includes("-")) {
      const m = /^(\d+)-(\d+)$/.exec(rangePart);
      if (!m) throw new Error(`range inválido "${piece}" no campo "${name}"`);
      lo = Number(m[1]);
      hi = Number(m[2]);
    } else {
      if (!/^\d+$/.test(rangePart)) throw new Error(`valor inválido "${piece}" no campo "${name}"`);
      lo = Number(rangePart);
      // "n/step" significa de n até o máximo do campo, pulando de step em step.
      hi = slash >= 0 ? inMax : lo;
    }

    if (lo > hi) throw new Error(`range invertido "${piece}" no campo "${name}"`);
    if (lo < min || hi > inMax) {
      throw new Error(`"${piece}" fora do range [${min},${inMax}] no campo "${name}"`);
    }
    for (let v = lo; v <= hi; v += step) set.add(idx === 4 ? v % 7 : v);
  }
  return set;
}

/** true se a string é um timezone IANA válido (rejeita typos antes de agendar). */
function isValidTimeZone(tz) {
  if (!tz) return true; // vazio = usa o default do servidor
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parseia uma expressão cron de 5 campos. Lança Error em qualquer coisa malformada. */
function parseCron(expr) {
  if (typeof expr !== "string") throw new Error("expressão cron deve ser string");
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron precisa de 5 campos, recebeu ${fields.length}: "${expr}"`);
  }
  return {
    minute: parseField(fields[0], 0),
    hour: parseField(fields[1], 1),
    dom: parseField(fields[2], 2),
    month: parseField(fields[3], 3),
    dow: parseField(fields[4], 4),
    domRestricted: fields[2].trim() !== "*",
    dowRestricted: fields[4].trim() !== "*",
  };
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _formatterCache = new Map();

function formatterFor(tz) {
  let f = _formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    _formatterCache.set(tz, f);
  }
  return f;
}

/** Componentes de parede (wall-clock) de um Date num timezone IANA. */
function partsInTz(date, tz) {
  let parts;
  try {
    parts = formatterFor(tz || "UTC").formatToParts(date);
  } catch {
    parts = formatterFor("UTC").formatToParts(date);
  }
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  let hour = Number(out.hour);
  if (hour === 24) hour = 0; // alguns ambientes emitem 24 à meia-noite
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
    dow: WEEKDAY_INDEX[out.weekday],
  };
}

/** true se `date` (avaliado em `tz`) casa com a expressão cron parseada. */
function cronMatches(parsed, date, tz) {
  const p = partsInTz(date, tz);
  if (!parsed.minute.has(p.minute)) return false;
  if (!parsed.hour.has(p.hour)) return false;
  if (!parsed.month.has(p.month)) return false;
  const domOk = parsed.dom.has(p.day);
  const dowOk = parsed.dow.has(p.dow);
  if (parsed.domRestricted && parsed.dowRestricted) return domOk || dowOk;
  if (parsed.domRestricted) return domOk;
  if (parsed.dowRestricted) return dowOk;
  return true;
}

/**
 * Próximo instante de match estritamente após `fromDate`.
 * Avança minuto-a-minuto com horizonte limitado (366 dias) pra nunca loopar
 * infinito numa expressão que não casa. Retorna Date ou null.
 */
function nextRunAfter(parsed, fromDate, tz) {
  const fromMs = fromDate instanceof Date ? fromDate.getTime() : Number(fromDate);
  // Próxima fronteira de minuto (minutos alinham em todos os timezones).
  const startMs = Math.floor(fromMs / 60000) * 60000 + 60000;
  const horizonMs = startMs + 366 * 24 * 60 * 60 * 1000;
  for (let t = startMs; t <= horizonMs; t += 60000) {
    const d = new Date(t);
    if (cronMatches(parsed, d, tz)) return d;
  }
  return null;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Compila um preset amigável da UI numa expressão cron.
 *   { kind: "hourly", minute }                  → "m * * * *"
 *   { kind: "daily",  time: "HH:MM" }           → "M H * * *"
 *   { kind: "weekly", time: "HH:MM", weekday }  → "M H * * dow"
 */
function presetToCron(preset) {
  const kind = preset && preset.kind;
  if (kind === "hourly") {
    const m = clampInt(preset.minute, 0, 59, 0);
    return `${m} * * * *`;
  }
  const time = String((preset && preset.time) || "08:00");
  const [hhRaw, mmRaw] = time.split(":");
  const h = clampInt(hhRaw, 0, 23, 8);
  const m = clampInt(mmRaw, 0, 59, 0);
  if (kind === "daily") return `${m} ${h} * * *`;
  if (kind === "weekly") {
    const dow = clampInt(preset.weekday, 0, 6, 1);
    return `${m} ${h} * * ${dow}`;
  }
  throw new Error(`preset de agenda desconhecido: ${kind}`);
}

/** Resolve a string cron efetiva de um schedule (preset compila; cron usa cru). */
function resolveCron(schedule) {
  if (!schedule || typeof schedule !== "object") throw new Error("schedule ausente");
  if (schedule.kind === "preset") return presetToCron(schedule.preset);
  const cron = schedule.cron;
  parseCron(cron); // valida
  return cron;
}

module.exports = {
  parseCron,
  cronMatches,
  nextRunAfter,
  presetToCron,
  resolveCron,
  partsInTz,
  isValidTimeZone,
};
