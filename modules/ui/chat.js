/* Chat rendering: messages, markdown, actions (copy/regen/edit/delete),
   streaming with text-node appendData (avoids O(n²) repaints), auto-scroll lock. */

import { renderMarkdown } from "../markdown.js";

/* ---------- pure functions (re-exported from chat-helpers.js for testability) ---------- */
export {
  forkMessagesAt,
  createFork,
  getAlternativeProfiles,
  replaceMessageContent,
  getBodyOverflowForModal,
} from "./chat-helpers.js";

import {
  forkMessagesAt,
  createFork,
  getAlternativeProfiles,
  replaceMessageContent,
  getBodyOverflowForModal,
} from "./chat-helpers.js";

let elements = null;
let state = null;
let store = null;
let onAction = null; // ({ action, messageId, content }) => void
let scrollLocked = false;
let scrollPending = false;

/* ---------- inline editor state ---------- */
let activeEditor = null; // { node, body, originalContent, originalReasoning, textarea, messageId }

export function initChat(opts) {
  elements = opts.elements;
  state = opts.state;
  store = opts.store;
  onAction = opts.onAction || (() => {});

  elements.messages.addEventListener("scroll", () => {
    const distance =
      elements.messages.scrollHeight -
      elements.messages.scrollTop -
      elements.messages.clientHeight;
    scrollLocked = distance > 64;
    if (elements.scrollDownButton) {
      elements.scrollDownButton.hidden = !scrollLocked;
    }
  });

  if (elements.scrollDownButton) {
    elements.scrollDownButton.addEventListener("click", () => {
      scrollLocked = false;
      forceScrollToBottom();
    });
  }
}

export function scrollToBottom() {
  if (scrollLocked) return;
  forceScrollToBottom();
}

/**
 * Renderiza (ou atualiza in-place) um bloco de chamada de ferramenta.
 *
 * Quando chamado sem `existingBlock`, cria um novo <details> com loading e
 * retorna a referência. Em uma segunda chamada com `existingBlock` (mesmo
 * <details>) e um `result`, troca o estado "Executando..." pelo resultado sem
 * recriar o bloco. Caller (app.js runToolCycle) usa esse ciclo para evitar
 * duplicação visual de tool calls.
 */
export function renderToolCallBlock(body, toolCall, result = null, existingBlock = null) {
  if (existingBlock && result !== null) {
    return updateToolCallBlock(existingBlock, result);
  }

  const details = document.createElement("details");
  details.className = "tool-block";

  const summary = document.createElement("summary");
  summary.className = "tool-summary";
  // Texto curto baseado no nome da tool — fica discreto na bolha do assistant.
  const toolName = toolCall.function.name;
  const icon = toolName === "web_search" ? "🔍"
            : toolName === "run_javascript" ? "🧮"
            : toolName === "get_current_datetime" ? "🕒"
            : "🔧";
  const label = toolName === "web_search" ? "Buscou na web"
              : toolName === "run_javascript" ? "Executou código"
              : toolName === "get_current_datetime" ? "Consultou data/hora"
              : "Ferramenta";
  const summaryCode = document.createElement("code");
  summaryCode.textContent = toolName;
  summaryCode.style.marginLeft = "6px";
  summary.append(`${icon} ${label}`, summaryCode);
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "tool-content";

  const argsHeader = document.createElement("div");
  argsHeader.className = "tool-section-label";
  argsHeader.textContent = "Argumentos:";
  content.appendChild(argsHeader);

  const argsPre = document.createElement("pre");
  argsPre.className = "tool-args";
  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    argsPre.textContent = JSON.stringify(parsed, null, 2);
  } catch {
    argsPre.textContent = toolCall.function.arguments || "";
  }
  content.appendChild(argsPre);

  if (result !== null) {
    appendToolResult(content, result);
  } else {
    const loading = document.createElement("div");
    loading.className = "tool-loading";
    loading.textContent = "⚙ Executando...";
    content.appendChild(loading);
  }

  details.appendChild(content);
  body.appendChild(details);
  scrollToBottom();
  return details;
}

function appendToolResult(contentEl, result) {
  const resHeader = document.createElement("div");
  resHeader.className = "tool-section-label tool-section-result";
  resHeader.textContent = "Resultado:";
  resHeader.style.marginTop = "var(--s-2)";
  contentEl.appendChild(resHeader);

  // === Sucesso de web_search: `__WEB_SEARCH_OK__:<provider>:<payload>` ===
  // Mostra os resultados em <pre> + chip discreto indicando qual provider
  // respondeu ("via Brave" verde, "via DuckDuckGo" cinza).
  if (typeof result === "string" && result.startsWith("__WEB_SEARCH_OK__:")) {
    const rest = result.slice("__WEB_SEARCH_OK__:".length);
    const colon = rest.indexOf(":");
    const provider = colon > 0 ? rest.slice(0, colon) : "unknown";
    const payload = colon > 0 ? rest.slice(colon + 1) : rest;

    const chip = document.createElement("span");
    chip.className = `tool-provider-chip provider-${provider}`;
    chip.textContent = provider === "brave" ? "via Brave"
                     : provider === "duckduckgo" ? "via DuckDuckGo"
                     : `via ${provider}`;
    resHeader.appendChild(chip);

    const resPre = document.createElement("pre");
    resPre.className = "tool-result";
    resPre.textContent = payload;
    contentEl.appendChild(resPre);
    return;
  }

  // === Erro de web_search: `__WEB_SEARCH_ERROR__:<code>:<braveStatus>:<msg>` ===
  // Renderiza caixa amarela com CTA contextual. braveStatus diz se o user
  // já configurou chave (texto do botão muda).
  if (typeof result === "string" && result.startsWith("__WEB_SEARCH_ERROR__:")) {
    const parts = result.slice("__WEB_SEARCH_ERROR__:".length).split(":");
    const code = parts.shift() || "unknown";
    const braveStatus = parts.shift() || "nao-configurada";
    const message = parts.join(":");

    const wrap = document.createElement("div");
    wrap.className = "tool-result tool-result-error";

    const msg = document.createElement("div");
    msg.className = "tool-error-message";
    msg.textContent = message;
    wrap.appendChild(msg);

    // Pra os erros que o usuário pode resolver via config, ação clara.
    if (code === "anti-bot" || code === "rate-limit" || code === "auth") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn btn-sm btn-primary tool-error-cta";
      action.style.marginTop = "var(--s-2)";
      action.textContent = code === "auth"
        ? "Conferir chave em Configurações"
        : braveStatus === "configurada"
          ? "Conferir chave em Configurações"
          : "Configurar busca confiável";
      action.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("open-settings", { detail: { tab: "advanced", anchor: "advanced-search-section" } }));
      });
      wrap.appendChild(action);
    }
    contentEl.appendChild(wrap);
    return;
  }

  const resPre = document.createElement("pre");
  resPre.className = "tool-result";
  resPre.textContent = result;
  contentEl.appendChild(resPre);
}

function updateToolCallBlock(details, result) {
  const content = details.querySelector(".tool-content");
  if (!content) return details;
  const loading = content.querySelector(".tool-loading");
  if (loading) loading.remove();
  // Se já existe um resultado (chamada duplicada), substitui em vez de empilhar.
  const oldHeader = content.querySelector(".tool-section-result");
  const oldResult = content.querySelector(".tool-result");
  if (oldHeader) oldHeader.remove();
  if (oldResult) oldResult.remove();
  appendToolResult(content, result);
  scrollToBottom();
  return details;
}

/**
 * Mostra indicador de que ferramentas estão sendo processadas.
 */
export function showToolProgress(body) {
  const div = document.createElement("div");
  div.className = "tool-progress-info";
  div.innerHTML = '<span class="typing-sm"></span> Processando ferramentas...';
  body.appendChild(div);
  scrollToBottom();
}


function forceScrollToBottom() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
    scrollPending = false;
  });
}

export function renderMessage(message, options = {}) {
  // Tool role messages são protocolo OpenAI (resultado da execução voltando pro
  // modelo). O usuário já vê o resultado dentro do tool block da mensagem do
  // assistant que invocou a tool — exibir como bolha separada de "Ferramenta"
  // duplica e polui. Mantemos no histórico (necessário pro modelo) mas não
  // renderizamos visualmente.
  if (message.role === "tool") return { node: null, body: null };

  const node = document.createElement("article");
  node.className = `msg msg-${message.role}`;
  if (options.noAnim) node.classList.add("no-anim");
  node.dataset.id = message.id || "";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = message.role === "user" ? "EU" : "AI";

  const content = document.createElement("div");
  content.className = "msg-content";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const role = document.createElement("span");
  role.className = "msg-role";
  let roleLabel = "Assistente";
  if (message.role === "user") roleLabel = "Você";
  else if (message.role === "tool") roleLabel = "Ferramenta";
  role.textContent = roleLabel;
  meta.appendChild(role);
  if (message.ts) {
    const time = document.createElement("time");
    const d = new Date(message.ts);
    time.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.appendChild(time);
  }

  const body = document.createElement("div");
  body.className = "msg-body";

  if (options.loading) {
    body.innerHTML =
      '<span class="typing"><span></span><span></span><span></span></span>';
  } else {
    setBodyContent(
      body,
      message.content || "",
      message.role === "assistant" && options.streaming,
      message.reasoning || "",
      message.tool_calls,
      options.toolResults || null,
    );
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  for (const [act, label] of [
    ["copy", "Copiar"],
    message.role === "assistant" ? ["regen", "Regenerar"] : null,
    message.role === "assistant" ? ["fork", "Continuar daqui"] : null,
    ["focus", "Foco"],
    ["edit", "Editar"],
    ["delete", "Excluir"],
  ].filter(Boolean)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "msg-action";
    btn.dataset.act = act;
    btn.textContent = label;
    if (act === "edit") {
      btn.addEventListener("click", () => openInlineEditor(node, body, message));
    } else if (act === "regen") {
      btn.addEventListener("click", (e) => openRegenMenu(e, btn, message, node, body));
    } else {
      btn.addEventListener("click", () =>
        onAction({ action: act, messageId: message.id, node, body, message })
      );
    }
    actions.appendChild(btn);
  }

  content.appendChild(meta);
  content.appendChild(body);
  content.appendChild(actions);

  node.appendChild(avatar);
  node.appendChild(content);
  elements.messagesInner.appendChild(node);
  scrollToBottom();

  return { node, body };
}

/* ---------- regen mini-menu ---------- */

function openRegenMenu(e, anchor, message, node, body) {
  e.stopPropagation();
  const existing = document.getElementById("regen-menu");
  if (existing) { existing.remove(); return; }

  const menu = document.createElement("div");
  menu.id = "regen-menu";
  menu.className = "palette-list";
  menu.style.position = "absolute";
  menu.style.background = "var(--bg-0)";
  menu.style.border = "1px solid var(--line)";
  menu.style.borderRadius = "var(--r-md)";
  menu.style.padding = "var(--s-1)";
  menu.style.boxShadow = "var(--shadow-2)";
  menu.style.zIndex = "20";
  menu.style.minWidth = "220px";

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener("click", onDocClick, true);
  };
  const onDocClick = (ev) => {
    if (!menu.contains(ev.target)) closeMenu();
  };

  for (const [act, label] of [
    ["regen", "Regenerar (mesmo perfil)"],
    ["ab-start", "Comparar com outro perfil"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "palette-item";
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.textContent = label;
    b.addEventListener("click", () => {
      // Fechar antes de despachar a ação garante que o listener no document
      // não fica órfão (bug anterior: o listener só removia em clicks fora).
      closeMenu();
      onAction({ action: act, messageId: message.id, node, body, message });
    });
    menu.appendChild(b);
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(menu);

  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
}

/* ---------- inline editor ---------- */

function openInlineEditor(node, body, message) {
  // Close any existing editor first
  if (activeEditor) closeInlineEditor(false);

  const originalContent = message.content || "";
  const originalReasoning = message.reasoning || "";

  // Build editor DOM
  const editorWrap = document.createElement("div");
  editorWrap.className = "msg-editor";

  const textarea = document.createElement("textarea");
  textarea.className = "msg-editor-textarea";
  textarea.value = originalContent;
  textarea.setAttribute("aria-label", "Editar mensagem");

  const preview = document.createElement("div");
  preview.className = "msg-editor-preview";
  if (originalContent) preview.appendChild(renderMarkdown(originalContent));

  const actionsRow = document.createElement("div");
  actionsRow.className = "msg-editor-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-sm btn-secondary";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => closeInlineEditor(false));

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-sm btn-primary";
  saveBtn.textContent = "Salvar";
  saveBtn.addEventListener("click", () => closeInlineEditor(true));

  actionsRow.appendChild(cancelBtn);
  actionsRow.appendChild(saveBtn);

  editorWrap.appendChild(textarea);
  editorWrap.appendChild(preview);
  editorWrap.appendChild(actionsRow);

  // Keyboard shortcuts
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeInlineEditor(false); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeInlineEditor(true); }
  });

  // Live markdown preview com debounce — re-parsear o texto inteiro a cada
  // keystroke causa jank visível em mensagens grandes. 120ms é suficiente para
  // não atrapalhar quem digita continuamente.
  let previewTimer = null;
  textarea.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      preview.replaceChildren(renderMarkdown(textarea.value));
    }, 120);
  });

  // Replace body content with editor
  body.replaceChildren(editorWrap);

  activeEditor = {
    node, body, originalContent, originalReasoning, textarea,
    messageId: message.id, message,
    cleanup: () => clearTimeout(previewTimer),
  };

  // Focus after DOM insertion
  requestAnimationFrame(() => textarea.focus());
}

function closeInlineEditor(save) {
  if (!activeEditor) return;
  const { body, originalContent, originalReasoning, textarea, messageId, message, cleanup } = activeEditor;
  activeEditor = null;
  cleanup?.();

  if (save) {
    const newContent = textarea.value;
    // Update the message object in place so re-renders are consistent
    message.content = newContent;
    // Notify app.js to persist
    onAction({ action: "edit-save", messageId, content: newContent });
    // Re-render body with new content
    setBodyContent(body, newContent, false, originalReasoning);
  } else {
    // Restore original content
    setBodyContent(body, originalContent, false, originalReasoning);
  }
}

/* Set body content: streaming uses raw <pre>, finalized uses markdown render.
   Optional reasoning is rendered as a collapsible "thinking" block above content.
   Optional tool_calls are rendered as collapsible blocks above content; quando
   há `toolResults` (Map<tool_call_id, content>), cada bloco já abre com o
   resultado renderizado (não fica "⚙ Executando..." pra sempre no histórico).
   Content can be a string or an OpenAI-compatible array (for image messages). */
export function setBodyContent(body, content, streaming = false, reasoning = "", tool_calls = null, toolResults = null) {
  body.replaceChildren();
  if (reasoning) {
    body.appendChild(buildReasoningBlock(reasoning, streaming));
  }
  if (tool_calls && Array.isArray(tool_calls)) {
    tool_calls.forEach(tc => {
      const result = toolResults && tc?.id ? toolResults.get(tc.id) : null;
      renderToolCallBlock(body, tc, result || null);
    });
  }
  // Handle array content (image messages)
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) {
        const img = document.createElement("img");
        img.src = part.image_url.url;
        img.alt = "Imagem anexada";
        img.style.maxWidth = "100%";
        img.style.maxHeight = "300px";
        img.style.borderRadius = "var(--r-md)";
        img.style.display = "block";
        img.style.marginBottom = "var(--s-2)";
        body.appendChild(img);
      } else if (part.type === "text" && part.text) {
        if (streaming) {
          const pre = document.createElement("pre");
          pre.className = "streaming msg-stream-content";
          pre.appendChild(document.createTextNode(part.text));
          body.appendChild(pre);
        } else {
          body.appendChild(renderMarkdown(part.text));
        }
      }
    }
    return;
  }
  if (streaming) {
    const pre = document.createElement("pre");
    pre.className = "streaming msg-stream-content";
    pre.appendChild(document.createTextNode(content));
    body.appendChild(pre);
  } else if (content) {
    body.appendChild(renderMarkdown(content));
  }
}

function buildReasoningBlock(reasoning, streaming) {
  const wrap = document.createElement("details");
  wrap.className = "msg-reasoning" + (streaming ? " streaming" : "");
  if (streaming) wrap.open = true; // open while streaming, user can collapse after
  const sum = document.createElement("summary");
  sum.textContent = streaming ? "💭 Pensando..." : "💭 Raciocínio (clique pra expandir)";
  wrap.appendChild(sum);
  const pre = document.createElement("pre");
  pre.className = "msg-reasoning-text";
  pre.appendChild(document.createTextNode(reasoning));
  wrap.appendChild(pre);
  return wrap;
}

/* Streaming-optimized append: keeps Text nodes and appendData per stream type. */
export function appendStreamingDelta(body, fullContent, fullReasoning = "") {
  // Reasoning block
  if (fullReasoning) {
    let reasoningWrap = body.querySelector(".msg-reasoning");
    if (!reasoningWrap) {
      reasoningWrap = buildReasoningBlock(fullReasoning, true);
      // Insert at top
      body.insertBefore(reasoningWrap, body.firstChild);
    } else {
      const pre = reasoningWrap.querySelector(".msg-reasoning-text");
      const textNode = pre?.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        if (fullReasoning.length > textNode.data.length) {
          textNode.appendData(fullReasoning.slice(textNode.data.length));
        } else {
          textNode.data = fullReasoning;
        }
      }
    }
  }

  // Content block
  if (fullContent) {
    let pre = body.querySelector("pre.msg-stream-content");
    if (!pre) {
      pre = document.createElement("pre");
      pre.className = "streaming msg-stream-content";
      pre.appendChild(document.createTextNode(""));
      body.appendChild(pre);
    }
    const textNode = pre.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      if (fullContent.length > textNode.data.length) {
        textNode.appendData(fullContent.slice(textNode.data.length));
      } else {
        textNode.data = fullContent;
      }
    }
  }

  scrollToBottom();
}

export function finalizeAssistant(body, content, isError = false, reasoning = "", meta = null) {
  if (isError) {
    body.classList.add("msg-error");
    body.replaceChildren(document.createTextNode(content));
  } else {
    body.classList.remove("msg-error");
    // Preservar tool blocks já renderizados durante runToolCycle — sem isso
    // o usuário vê o resultado da tool durante streaming e perde quando o
    // assistant finaliza (o body é reconstruído do zero).
    const toolBlocks = [...body.querySelectorAll(":scope > .tool-block")];
    body.replaceChildren();
    if (reasoning) {
      const block = buildReasoningBlock(reasoning, false);
      block.open = false; // collapse after streaming finishes
      body.appendChild(block);
    }
    for (const tb of toolBlocks) body.appendChild(tb);
    if (content) body.appendChild(renderMarkdown(content));
    if (meta?.usage || meta?.finishReason || meta?.elapsed) {
      body.appendChild(buildStatsLine(meta));
    }
  }
  scrollToBottom();
}

function buildStatsLine(meta) {
  const u = meta.usage || {};
  const parts = [];
  if (u.prompt_tokens) parts.push(`${u.prompt_tokens.toLocaleString()} prompt`);
  const reasoningT = u.completion_tokens_details?.reasoning_tokens;
  if (reasoningT) parts.push(`${reasoningT.toLocaleString()} reasoning`);
  if (u.completion_tokens) {
    const contentT = reasoningT ? u.completion_tokens - reasoningT : u.completion_tokens;
    parts.push(`${contentT.toLocaleString()} content`);
  }
  if (meta.finishReason) parts.push(`stop: ${meta.finishReason}`);
  // elapsed time and tok/s from generation timer
  if (meta.elapsed != null && meta.elapsed > 0) {
    const secs = (meta.elapsed / 1000).toFixed(1);
    parts.push(`${secs}s`);
    const completionTokens = u.completion_tokens || 0;
    if (completionTokens > 0) {
      const tps = (completionTokens / (meta.elapsed / 1000)).toFixed(1);
      parts.push(`${tps} tok/s`);
    }
  }
  if (!parts.length) return document.createDocumentFragment();
  const div = document.createElement("div");
  div.className = "msg-stats";
  div.textContent = parts.join(" · ");
  return div;
}

export function clearMessages() {
  elements.messagesInner.replaceChildren();
}
export function renderAllMessages(messages) {
  clearMessages();
  // Pre-build map de tool_call_id → result string olhando o histórico inteiro.
  const toolResults = new Map();
  for (const m of messages) {
    if (m && m.role === "tool" && m.tool_call_id) {
      // Prefere `_display` (com markers para UI rica) sobre `content` (versão
      // limpa enviada ao LLM). Veja stripWebSearchMarker em app.js.
      toolResults.set(m.tool_call_id, m._display || m.content || "");
    }
  }

  // Mescla [assistant(tool_calls, content=vazio) → tool → assistant(content)]
  // em UMA bolha visual. O protocolo OpenAI requer mensagens separadas (o
  // histórico salvo mantém isso pro LLM), mas pro usuário é uma única "rodada"
  // do assistente — duas bolhas iguais com timestamps iguais é ruído.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "tool") continue; // tool messages: protocolo interno, hidden

    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0 &&
      !(m.content || "").trim()
    ) {
      // Acumular todas as tool_calls dessa cadeia até achar o assistant final.
      const allToolCalls = [...m.tool_calls];
      let j = i + 1;
      let final = m;
      while (j < messages.length) {
        const next = messages[j];
        if (!next) { j++; continue; }
        if (next.role === "tool") { j++; continue; }
        if (
          next.role === "assistant" &&
          Array.isArray(next.tool_calls) &&
          next.tool_calls.length > 0 &&
          !(next.content || "").trim()
        ) {
          allToolCalls.push(...next.tool_calls);
          j++;
          continue;
        }
        final = next;
        break;
      }
      const merged = { ...final, tool_calls: allToolCalls };
      renderMessage(merged, { noAnim: true, toolResults });
      // Pula para depois do final encontrado (j aponta pra ele, queremos j+1).
      i = j;
      continue;
    }

    renderMessage(m, { noAnim: true, toolResults });
  }
}

export function removeMessageNode(node) {
  node?.remove();
}

export function setLoadingTyping(body) {
  body.innerHTML =
    '<span class="typing"><span></span><span></span><span></span></span>';
}

/* ---------- generation timer ---------- */

export function startGenerationTimer(body) {
  const startTime = Date.now();
  let tokenCount = 0;
  let intervalId = null;

  const progressEl = document.createElement("div");
  progressEl.className = "msg-progress";
  progressEl.setAttribute("aria-live", "polite");

  const timeEl = document.createElement("span");
  timeEl.className = "msg-progress-time";
  timeEl.textContent = "0s";

  const tpsEl = document.createElement("span");
  tpsEl.className = "msg-progress-tps";

  progressEl.appendChild(timeEl);
  progressEl.appendChild(tpsEl);

  // Insert at the start of body (before streaming content)
  body.insertBefore(progressEl, body.firstChild);

  const update = () => {
    const elapsed = Date.now() - startTime;
    const secs = Math.floor(elapsed / 1000);
    timeEl.textContent = `${secs}s`;
    if (tokenCount > 0 && elapsed > 0) {
      const tps = (tokenCount / (elapsed / 1000)).toFixed(1);
      tpsEl.textContent = `· ${tps} tok/s`;
    }
  };

  intervalId = setInterval(update, 1000);

  return {
    stop: () => {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      progressEl.remove();
    },
    getElapsed: () => Date.now() - startTime,
    getTokenCount: () => tokenCount,
    setTokenCount: (n) => { tokenCount = n; },
  };
}

export function stopGenerationTimer(handle) {
  if (!handle) return;
  handle.stop();
}
