/* Chat rendering: messages, markdown, actions (copy/regen/edit/delete),
   streaming with text-node appendData (avoids O(n²) repaints), auto-scroll lock. */

import { renderMarkdown } from "../markdown.js";

let elements = null;
let state = null;
let store = null;
let onAction = null; // ({ action, messageId, content }) => void
let scrollLocked = false;
let scrollPending = false;

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
    btn.addEventListener("click", () =>
      onAction({ action: act, messageId: message.id, node, body, message })
    );
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
    if (meta?.usage || meta?.finishReason) {
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
