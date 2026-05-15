/* Tool Manager — handles registration, validation and execution of tools. */

const BUILTIN_PREFIX = "builtin-";

/**
 * Registra as ferramentas built-in padrão.
 * @returns {object[]}
 */
export function getBuiltInTools() {
  return [
    {
      id: "builtin-get_current_datetime",
      name: "get_current_datetime",
      description: "Retorna a data e hora atual com timezone do browser no formato ISO 8601.",
      parameters: { type: "object", properties: {}, required: [] },
      implementation: "builtin:get_current_datetime",
      enabled: false,
      builtIn: true,
    },
    {
      id: "builtin-web_search",
      name: "web_search",
      description: "Busca na web e retorna os primeiros resultados com título, URL e snippet.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termo de busca" }
        },
        required: ["query"]
      },
      implementation: "builtin:web_search",
      enabled: false,
      builtIn: true,
    },
    {
      id: "builtin-run_javascript",
      name: "run_javascript",
      description: "Executa código JavaScript e retorna o resultado. Sem acesso a DOM, fetch ou rede.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Código JavaScript a executar" }
        },
        required: ["code"]
      },
      implementation: "builtin:run_javascript",
      enabled: false,
      builtIn: true,
    },
  ];
}

/**
 * Valida o nome de uma ferramenta (OpenAI style: [a-z0-9_]{1,64}).
 */
export function validateToolName(name) {
  return /^[a-z0-9_]{1,64}$/.test(name);
}

/**
 * Valida se um objeto é um JSON Schema de parâmetros válido.
 */
export function validateParametersSchema(schema) {
  if (!schema || typeof schema !== "object") return { ok: false, error: "Schema deve ser um objeto." };
  if (schema.type !== "object") return { ok: false, error: "Schema de parâmetros deve ser do tipo 'object'." };
  if (schema.properties && typeof schema.properties !== "object") return { ok: false, error: "'properties' deve ser um objeto." };
  return { ok: true };
}

/**
 * Serializa um resultado de ferramenta para string.
 */
export function serializeToolResult(value) {
  if (value === undefined || value === null) return "(sem resultado)";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Executa uma ferramenta.
 */
export async function executeTool(toolCall, allTools, options = {}) {
  const { name, arguments: argsJson } = toolCall.function;
  const tool = allTools.find(t => t.name === name);
  
  if (!tool) {
    return `Erro: ferramenta '${name}' não encontrada.`;
  }

  let args;
  try {
    args = JSON.parse(argsJson || "{}");
  } catch (err) {
    return `Erro ao parsear argumentos: ${err.message}`;
  }

  // Built-ins
  if (tool.implementation.startsWith("builtin:")) {
    const builtinName = tool.implementation.split(":")[1];
    return executeBuiltIn(builtinName, args, options);
  }

  // Custom tools (Sandbox)
  return runInSandbox(tool.implementation, args, 5000, options.signal);
}

async function executeBuiltIn(name, args, options) {
  switch (name) {
    case "get_current_datetime":
      return new Date().toISOString();

    case "web_search":
      return handleWebSearch(args.query, options);
    // Nota: `options.braveApiKey` é injetado pelo app.js lendo store.get("advanced.search.braveApiKey").

    case "run_javascript":
      return runInSandbox(args.code, args || {}, 5000, options.signal);

    default:
      return `Erro: implementação built-in '${name}' não encontrada.`;
  }
}

async function handleWebSearch(query, options) {
  if (!query) return "Erro: query de busca vazia.";

  // Brave key opcional do localStorage (Settings → Avançado). Sem key, server
  // usa DDG. Com key, server tenta Brave primeiro e cai pro DDG só se falhar.
  const braveApiKey = options.braveApiKey || "";

  try {
    const resp = await fetch("/api/tools/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, braveApiKey }),
      signal: options.signal,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Devolve o errorCode pro app.js poder renderizar UI específica
      // (link pra Settings quando for anti-bot, etc).
      const code = data.errorCode || "unknown";
      const braveStatus = braveApiKey ? "configurada" : "nao-configurada";
      return `__WEB_SEARCH_ERROR__:${code}:${braveStatus}:${data.error || resp.statusText}`;
    }
    // Prefixo `__WEB_SEARCH_OK__:<provider>:` permite o tool block mostrar um
    // chip indicando qual backend respondeu. Limpo pelo client antes do modelo
    // ver — o modelo só recebe o JSON dos resultados.
    return `__WEB_SEARCH_OK__:${data.provider || "unknown"}:${serializeToolResult(data.results)}`;
  } catch (err) {
    return `Erro de rede ao buscar na web: ${err.message}`;
  }
}

/**
 * Executa código JS em um iframe sandboxed (cross-origin, opaque origin).
 *
 * O iframe usa `sandbox="allow-scripts"` (sem `allow-same-origin`), o que força
 * uma origem opaca: `localStorage`, `indexedDB`, cookies e o DOM do parent ficam
 * inacessíveis. A comunicação é feita via postMessage com um nonce gerado por
 * `crypto.randomUUID()` para impedir cross-talk com outros iframes/extensions.
 *
 * O signal (vindo do tool cycle) cancela a execução: removemos o iframe e
 * resolvemos com mensagem de cancelamento. Timeout default 5s.
 */
export async function runInSandbox(code, args, timeoutMs = 5000, signal) {
  if (signal?.aborted) return "Erro: cancelado pelo usuário.";

  return new Promise((resolve) => {
    const nonce = (crypto.randomUUID && crypto.randomUUID()) ||
                  `n${Math.random().toString(36).slice(2)}${Date.now()}`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;left:-9999px";

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { iframe.remove(); } catch {}
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const onMessage = (ev) => {
      // Cross-origin iframes have ev.source pointing at their window proxy.
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data;
      if (!data || data.nonce !== nonce) return;
      if (data.ok) finish(serializeToolResult(data.value));
      else finish(`Erro na execução: ${data.error || "desconhecido"}`);
    };
    const onAbort = () => finish("Erro: cancelado pelo usuário.");
    const timer = setTimeout(
      () => finish(`Erro: timeout de execução (${timeoutMs}ms) excedido.`),
      timeoutMs
    );

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });

    // Build srcdoc with the user code wrapped. The code receives `args` and the
    // result (sync or async) is shipped back via postMessage("*"). We use "*"
    // because allow-scripts (no allow-same-origin) gives the iframe an opaque
    // origin that the parent cannot enumerate; the parent verifies ev.source.
    const codeJson = JSON.stringify(`"use strict"; ${code}`);
    const argsJson = JSON.stringify(args ?? {});
    const nonceJson = JSON.stringify(nonce);
    const srcdoc =
      "<!doctype html><meta charset=\"utf-8\"><script>(async () => {" +
      "  const NONCE = " + nonceJson + ";" +
      "  try {" +
      "    const fn = new Function('args', " + codeJson + ");" +
      "    const out = await fn(" + argsJson + ");" +
      "    parent.postMessage({ nonce: NONCE, ok: true, value: out }, '*');" +
      "  } catch (e) {" +
      "    parent.postMessage({ nonce: NONCE, ok: false, error: String(e && e.message || e) }, '*');" +
      "  }" +
      "})();<\/script>";
    iframe.srcdoc = srcdoc;
    document.body.appendChild(iframe);
  });
}

/**
 * Converte a lista de ferramentas do store para o formato OpenAI.
 */
export function getOpenAIToolDefinitions(tools, enabledIds = []) {
  const active = tools.filter(t => enabledIds.includes(t.id));
  if (!active.length) return undefined;

  return active.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}
