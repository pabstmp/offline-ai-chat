/* server-lib/llm.js — chamada LLM não-streaming, in-process.
 *
 * O server.js só faz PROXY (upstream.pipe(response)); não havia jeito de chamar
 * o LLM e receber a resposta DENTRO do processo. As tarefas agendadas precisam
 * disso (ex: resumir resultados de busca num boletim). Este módulo coleta o body
 * em vez de fazer pipe, faz parse e extrai content/reasoning/usage.
 *
 * Factory com DI: recebe `normalizeBaseUrl` e `isOpenRouterHost` do server.js,
 * mantendo o guard SSRF (`isAllowedProxyTarget`) com fonte única — este módulo
 * nunca decide sozinho quais hosts são permitidos.
 */
"use strict";

const http = require("node:http");
const https = require("node:https");

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function createLlmCaller(deps = {}) {
  const normalizeBaseUrl = deps.normalizeBaseUrl;
  const isOpenRouterHost = deps.isOpenRouterHost || (() => false);
  const defaultTimeoutMs = deps.defaultTimeoutMs || 120_000;
  if (typeof normalizeBaseUrl !== "function") {
    throw new Error("createLlmCaller requer normalizeBaseUrl injetado.");
  }

  /**
   * @returns {Promise<{content:string, reasoning:string, usage:object|null, finishReason:string|null, raw:object}>}
   */
  function callLLMOnce({ baseUrl, apiKey, payload, timeoutMs, signal }) {
    return new Promise((resolve, reject) => {
      let base;
      try {
        base = normalizeBaseUrl(baseUrl); // valida + aplica allowlist (SSRF guard)
      } catch (err) {
        reject(err);
        return;
      }
      const target = new URL(`${base.pathname}/chat/completions`, base);
      const finalPayload = { ...(payload || {}), stream: false };
      const bodyBuf = Buffer.from(JSON.stringify(finalPayload));
      const client = target.protocol === "https:" ? https : http;

      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Length": bodyBuf.length,
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (isOpenRouterHost(target.hostname)) {
        headers["HTTP-Referer"] = "https://offline-ai-chat.local";
        headers["X-Title"] = "Offline AI Chat";
      }

      const reqOptions = { method: "POST", headers };
      if (signal) reqOptions.signal = signal;

      const req = client.request(target, reqOptions, (res) => {
        const status = res.statusCode || 502;
        const chunks = [];
        let bytes = 0;
        res.on("data", (c) => {
          bytes += c.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("Resposta do LLM excedeu 8 MiB."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (status >= 400) {
            reject(new Error(`LLM retornou HTTP ${status}: ${text.slice(0, 500)}`));
            return;
          }
          let data;
          try {
            data = JSON.parse(text);
          } catch (err) {
            reject(new Error(`LLM: parse JSON falhou (${err.message})`));
            return;
          }
          const choice = (data && data.choices && data.choices[0]) || {};
          const message = choice.message || {};
          resolve({
            content: typeof message.content === "string" ? message.content : "",
            reasoning: typeof message.reasoning_content === "string" ? message.reasoning_content : "",
            usage: data.usage || null,
            finishReason: choice.finish_reason || null,
            raw: data,
          });
        });
      });

      req.setTimeout(timeoutMs || defaultTimeoutMs, () => {
        req.destroy(new Error(`Timeout do LLM (${timeoutMs || defaultTimeoutMs}ms).`));
      });
      req.on("error", (err) => {
        // AbortError propaga com .name === "AbortError" — preserva pra o caller distinguir.
        reject(err);
      });
      req.write(bodyBuf);
      req.end();
    });
  }

  return { callLLMOnce };
}

module.exports = { createLlmCaller, MAX_RESPONSE_BYTES };
