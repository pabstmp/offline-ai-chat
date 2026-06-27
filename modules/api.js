/* API client: normalize URLs, list models, request completion (with stream). */

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

export function normalizeBaseUrl(rawValue) {
  let value = (rawValue || "").trim() || DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (!url.port && (!path || path === "/")) url.port = "1234";
  url.pathname = path && path !== "/" ? path : "/v1";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function readError(response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.message || text.slice(0, 700);
  } catch {
    return text.slice(0, 700);
  }
}

export function formatFetchError(error) {
  if (window.location.protocol === "file:") {
    return "Abra a página pelo Docker (`docker compose up -d --build`) ou pelo servidor local (`node server.js`).";
  }
  if (error?.name === "AbortError") return "Tempo esgotado ou requisição interrompida.";
  if (error instanceof TypeError) {
    return "Não consegui acessar o proxy local ou o LM Studio. Confira se o servidor OpenAI-compatible está ativo.";
  }
  return error?.message || "Erro desconhecido.";
}

export function extractAssistantContent(data) {
  const choice = data?.choices?.[0];
  return (
    choice?.message?.content ||
    choice?.delta?.content ||
    choice?.text ||
    data?.output_text ||
    ""
  );
}

/* Extract reasoning (for thinking models like Gemma 3+, DeepSeek R1, GPT-o1, etc.).
   Returns "" if not a reasoning model. */
export function extractReasoningContent(data) {
  const choice = data?.choices?.[0];
  return (
    choice?.message?.reasoning_content ||
    choice?.delta?.reasoning_content ||
    choice?.message?.reasoning ||
    choice?.delta?.reasoning ||
    ""
  );
}

/* Combined extractor — returns { content, reasoning } */
export function extractDelta(data) {
  return {
    content: extractAssistantContent(data),
    reasoning: extractReasoningContent(data),
  };
}

export async function listModels({ baseUrl, apiKey, timeoutMs = 12000 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey || "", baseUrl }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data.map((m) => {
      if (!m) return null;
      if (typeof m === "string") {
        return { id: m, name: m, pricing: null, isFree: true };
      }
      const prompt = Number(m.pricing?.prompt) || 0;
      const completion = Number(m.pricing?.completion) || 0;
      return {
        id: m.id,
        name: m.name || m.id,
        pricing: m.pricing || null,
        isFree: prompt === 0 && completion === 0,
      };
    }).filter((m) => m && m.id) : [];
  } finally {
    clearTimeout(t);
  }
}

/* Cap de buffer SSE: linha sem `\n` maior que 1 MiB é hostil (servidor
   adversário ou modelo em loop). Aborta a leitura em vez de inflar memória. */
const SSE_MAX_BUFFER_BYTES = 1 << 20;

/* Acumula tool_calls de deltas SSE em curso. OpenAI emite tool_calls fragmentados
   por `index`: o primeiro chunk traz `id`/`function.name`, os seguintes só trazem
   pedaços de `function.arguments` (JSON sendo construído em streaming). */
function mergeToolCallDelta(acc, deltaToolCalls) {
  if (!Array.isArray(deltaToolCalls)) return;
  for (const tc of deltaToolCalls) {
    const idx = typeof tc.index === "number" ? tc.index : acc.length;
    if (!acc[idx]) {
      acc[idx] = {
        id: tc.id || "",
        type: tc.type || "function",
        function: { name: "", arguments: "" },
      };
    }
    const target = acc[idx];
    if (tc.id) target.id = tc.id;
    if (tc.type) target.type = tc.type;
    if (tc.function) {
      if (tc.function.name) target.function.name += tc.function.name;
      if (tc.function.arguments) target.function.arguments += tc.function.arguments;
    }
  }
}

export async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage = null;
  let finishReason = null;
  const toolCallsAcc = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > SSE_MAX_BUFFER_BYTES) {
        throw new Error("SSE buffer overflow (linha sem \\n excedeu 1 MiB).");
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          const toolCalls = toolCallsAcc.length ? toolCallsAcc.filter(Boolean) : null;
          return { content, reasoning, usage, finishReason, toolCalls };
        }
        try {
          const parsed = JSON.parse(payload);
          const d = extractDelta(parsed);
          if (d.content) content += d.content;
          if (d.reasoning) reasoning += d.reasoning;
          // tool_calls vêm em delta.tool_calls (streaming) ou message.tool_calls (final).
          const dTc = parsed?.choices?.[0]?.delta?.tool_calls
                   || parsed?.choices?.[0]?.message?.tool_calls;
          if (dTc) mergeToolCallDelta(toolCallsAcc, dTc);
          // Capture finish_reason from last chunk (LM Studio sends it in the choice)
          const fr = parsed?.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          // Capture usage if present (some servers include it in the final chunk)
          if (parsed?.usage) usage = parsed.usage;
          if (d.content || d.reasoning) {
            onDelta(d, { content, reasoning });
          }
        } catch { /* ignore keep-alive */ }
      }
    }
    const toolCalls = toolCallsAcc.length ? toolCallsAcc.filter(Boolean) : null;
    return { content, reasoning, usage, finishReason, toolCalls };
  } finally {
    // Garantir release do reader em qualquer caminho (abort, throw, overflow).
    // Sem isso o ReadableStream fica locked indefinidamente.
    try { await reader.cancel(); } catch {}
  }
}

export async function requestCompletion({ baseUrl, apiKey, payload, signal }, onDelta) {
  const response = await fetch("/api/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: apiKey || "", baseUrl, payload }),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (payload.stream && response.body) return readStream(response, onDelta);
  const data = await response.json();
  return {
    content: extractAssistantContent(data),
    reasoning: extractReasoningContent(data),
    usage: data?.usage || null,
    finishReason: data?.choices?.[0]?.finish_reason || null,
    toolCalls: extractToolCalls(data),
  };
}

/* Embeddings — calls /api/embeddings proxy.
   input can be string or array of strings. Returns array of Float32Array vectors. */
export async function requestEmbeddings({ baseUrl, apiKey, model, input, signal }) {
  const inputs = Array.isArray(input) ? input : [input];
  const response = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: apiKey || "",
      baseUrl,
      payload: { model, input: inputs },
    }),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  if (!Array.isArray(data?.data)) {
    throw new Error("Resposta de embeddings inválida (esperado data: [...])");
  }
  return data.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => new Float32Array(d.embedding || []));
}

/* LM Studio extended API: list models with detailed info
   (state, max_context_length, loaded_context_length, arch, type) */
export async function lmListModelsInfo({ baseUrl, apiKey, signal }) {
  const r = await fetch("/api/lm/models-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: apiKey || "" }),
    signal,
  });
  if (!r.ok) throw new Error(await readError(r));
  const data = await r.json();
  return Array.isArray(data?.data) ? data.data : [];
}

/* Load a model with custom context length */
export async function lmLoadModel({ baseUrl, apiKey, model, contextLength, flashAttention = false, signal }) {
  const r = await fetch("/api/lm/load-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl,
      apiKey: apiKey || "",
      payload: {
        model,
        ...(contextLength ? { context_length: contextLength } : {}),
        ...(flashAttention ? { flash_attention: true } : {}),
      },
    }),
    signal,
  });
  if (!r.ok) throw new Error(await readError(r));
  return await r.json();
}

export async function lmUnloadModel({ baseUrl, apiKey, model, signal }) {
  // LM Studio's /api/v1/models/unload expects `instance_id`, not `model`.
  // For loaded singletons the instance_id matches the model id.
  const r = await fetch("/api/lm/unload-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey: apiKey || "", payload: { instance_id: model } }),
    signal,
  });
  if (!r.ok) throw new Error(await readError(r));
  return await r.json();
}

/* Build payload omitting null/empty sampling fields */
export function buildSamplingPayload(sampling) {
  const out = {};
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (k === "response_format") {
      if (v === "json_object") out.response_format = { type: "json_object" };
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Extrai tool_calls. Aceita tanto resposta completa do OpenAI
 * (`choices[0].message.tool_calls`) quanto o shape devolvido por `readStream`
 * (`{ toolCalls: [...] }`), pra que o caller possa usar uma única função
 * indiferente ao modo (streaming ou não).
 */
export function extractToolCalls(data) {
  if (!data) return null;
  if (Array.isArray(data.toolCalls) && data.toolCalls.length) return data.toolCalls;
  return data?.choices?.[0]?.message?.tool_calls || null;
}

/**
 * Extrai finish_reason do objeto choice.
 */
export function extractFinishReason(data) {
  return data?.choices?.[0]?.finish_reason || null;
}

/* ---------- cron / tarefas agendadas ----------
   Diferente dos endpoints de modelo, NÃO mandamos baseUrl/apiKey: as tarefas e
   conexões vivem no servidor (cron-state.json). Estes wrappers só falam com
   /api/cron/*. Segredos nunca trafegam de volta (server redige pra "***"). */
async function cronPost(pathname, body) {
  const response = await fetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export function cronList() {
  return cronPost("/api/cron/list", {});
}
export function cronUpsertTask(task) {
  return cronPost("/api/cron/upsert", { task });
}
export function cronDeleteTask(id) {
  return cronPost("/api/cron/delete", { id });
}
export function cronRunNow(id) {
  return cronPost("/api/cron/run-now", { id });
}
export function cronHistory(id) {
  return cronPost("/api/cron/history", { id });
}
export function cronResult(id, runId) {
  return cronPost("/api/cron/result", { id, runId });
}
export function cronUpsertConnection(connection) {
  return cronPost("/api/cron/connection-upsert", { connection });
}
export function cronDeleteConnection(id) {
  return cronPost("/api/cron/connection-delete", { id });
}
export function cronUpsertAgent(agent) {
  return cronPost("/api/cron/agent-upsert", { agent });
}
export function cronDeleteAgent(id) {
  return cronPost("/api/cron/agent-delete", { id });
}

