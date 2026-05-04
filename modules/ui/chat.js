/* Chat rendering: messages, markdown, actions (copy/regen/edit/delete),
   streaming with text-node appendData (avoids O(n²) repaints), auto-scroll lock. */

import { renderMarkdown } from "../markdown.js";

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

function forceScrollToBottom() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
    scrollPending = false;
  });
}

export function renderMessage(message, options = {}) {
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
  role.textContent = message.role === "user" ? "Você" : "Assistente";
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
    setBodyContent(body, message.content || "", message.role === "assistant" && options.streaming);
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  for (const [act, label] of [
    ["copy", "Copiar"],
    message.role === "assistant" ? ["regen", "Regenerar"] : null,
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

  // Live markdown preview
  textarea.addEventListener("input", () => {
    preview.replaceChildren(renderMarkdown(textarea.value));
  });

  // Replace body content with editor
  body.replaceChildren(editorWrap);

  activeEditor = { node, body, originalContent, originalReasoning, textarea, messageId: message.id, message };

  // Focus after DOM insertion
  requestAnimationFrame(() => textarea.focus());
}

function closeInlineEditor(save) {
  if (!activeEditor) return;
  const { body, originalContent, originalReasoning, textarea, messageId, message } = activeEditor;
  activeEditor = null;

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
   Optional reasoning is rendered as a collapsible "thinking" block above content. */
export function setBodyContent(body, content, streaming = false, reasoning = "") {
  body.replaceChildren();
  if (reasoning) {
    body.appendChild(buildReasoningBlock(reasoning, streaming));
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
    body.replaceChildren();
    if (reasoning) {
      const block = buildReasoningBlock(reasoning, false);
      block.open = false; // collapse after streaming finishes
      body.appendChild(block);
    }
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
  for (const m of messages) renderMessage(m, { noAnim: true });
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
