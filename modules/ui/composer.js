/* Composer: textarea auto-resize (guarded), token estimator, slash command
   suggestions overlay, send/stop button management. */

import { estimateTokens } from "../markdown.js";

let elements = null;
let store = null;
let onSubmit = null;
let onSlashSelect = null;
let lastLength = -1;

export function initComposer(opts) {
  elements = opts.elements;
  store = opts.store;
  onSubmit = opts.onSubmit || (() => {});
  onSlashSelect = opts.onSlashSelect || (() => {});

  elements.promptInput.addEventListener("input", () => {
    autoResize();
    updateTokenCount();
    handleSlashSuggestions();
  });

  elements.promptInput.addEventListener("keydown", (e) => {
    const submitOn = store?.get("behavior.submitOn") || "enter";
    if (slashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveSlashSelection(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); moveSlashSelection(-1); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); applySlashSelection(); return; }
      if (e.key === "Escape") { e.preventDefault(); closeSlashSuggestions(); return; }
    }
    if (e.key === "Enter") {
      const wantsSend =
        (submitOn === "enter" && !e.shiftKey) ||
        (submitOn === "ctrl-enter" && (e.ctrlKey || e.metaKey));
      if (wantsSend) {
        e.preventDefault();
        elements.chatForm.requestSubmit();
      }
    }
  });

  elements.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    let text = elements.promptInput.value.trim();
    if (!text) return;
    text = applySlashCommandExpansion(text);
    onSubmit(text);
  });
}

export function clearComposer() {
  elements.promptInput.value = "";
  lastLength = -1;
  autoResize();
  updateTokenCount();
}

export function focusComposer() {
  elements.promptInput.focus();
}

export function setComposerValue(text) {
  elements.promptInput.value = text;
  lastLength = -1;
  autoResize();
  updateTokenCount();
}

function autoResize() {
  const ta = elements.promptInput;
  if (ta.value.length === lastLength) return;
  lastLength = ta.value.length;
  ta.style.height = "auto";
  const max = window.innerHeight * 0.4;
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
}

let tokenRafPending = false;
function updateTokenCount() {
  if (tokenRafPending) return;
  tokenRafPending = true;
  requestAnimationFrame(() => {
    tokenRafPending = false;
    const text = elements.promptInput.value;
    const promptTokens = estimateTokens(text);
    const historyTokens = computeHistoryTokens();
    const total = promptTokens + historyTokens;
    elements.tokenCount.textContent = `~${total} tok`;
    elements.tokenCount.classList.toggle("warn", total > 6000 && total <= 12000);
    elements.tokenCount.classList.toggle("danger", total > 12000);
  });
}

function computeHistoryTokens() {
  // hook: external code can update via setHistoryTokens
  return historyTokens;
}

let historyTokens = 0;
export function setHistoryTokens(n) {
  historyTokens = n;
  updateTokenCount();
}

/* ---------- slash commands ---------- */

let slashOpen = false;
let slashOverlay = null;
let slashIndex = 0;
let slashItems = [];

function getSlashCommands() {
  const slash = store?.get("advanced.slashCommands") || [];
  const lib = store?.get("advanced.promptLibrary") || [];
  return [
    ...slash.map((s) => ({ trigger: s.trigger, label: s.trigger, body: s.expansion, kind: "slash" })),
    ...lib.map((p) => ({ trigger: `/${p.id}`, label: `/${p.id}`, body: p.body, kind: "library", name: p.name })),
  ];
}

function handleSlashSuggestions() {
  const text = elements.promptInput.value;
  // detect leading slash command at start of input or after newline
  const m = text.match(/(^|\n)(\/\w*)$/);
  if (!m) {
    closeSlashSuggestions();
    return;
  }
  const prefix = m[2].toLowerCase();
  const all = getSlashCommands();
  slashItems = all.filter((c) => c.trigger.toLowerCase().startsWith(prefix));
  if (!slashItems.length) {
    closeSlashSuggestions();
    return;
  }
  slashIndex = 0;
  openSlashSuggestions();
}

function ensureOverlay() {
  if (slashOverlay) return slashOverlay;
  slashOverlay = document.createElement("div");
  slashOverlay.className = "palette-list";
  slashOverlay.style.position = "absolute";
  slashOverlay.style.background = "var(--bg-0)";
  slashOverlay.style.border = "1px solid var(--line)";
  slashOverlay.style.borderRadius = "var(--r-md)";
  slashOverlay.style.boxShadow = "var(--shadow-2)";
  slashOverlay.style.padding = "var(--s-1)";
  slashOverlay.style.zIndex = "15";
  slashOverlay.style.maxHeight = "240px";
  slashOverlay.style.overflowY = "auto";
  slashOverlay.style.minWidth = "260px";
  document.body.appendChild(slashOverlay);
  return slashOverlay;
}

function openSlashSuggestions() {
  const overlay = ensureOverlay();
  overlay.replaceChildren();
  slashItems.forEach((it, idx) => {
    const li = document.createElement("button");
    li.type = "button";
    li.className = "palette-item";
    li.style.width = "100%";
    li.style.textAlign = "left";
    li.setAttribute("aria-selected", idx === slashIndex ? "true" : "false");
    const span = document.createElement("span");
    span.style.fontFamily = "var(--font-mono)";
    span.textContent = it.label;
    const small = document.createElement("span");
    small.style.color = "var(--fg-2)";
    small.style.marginLeft = "8px";
    small.style.fontSize = "var(--fs-xs)";
    small.textContent = it.name || it.body.slice(0, 40);
    li.appendChild(span);
    li.appendChild(small);
    li.addEventListener("mouseenter", () => { slashIndex = idx; refreshSlashSelection(); });
    li.addEventListener("click", () => { applySlashSelection(); });
    overlay.appendChild(li);
  });
  positionOverlay();
  slashOpen = true;
}

function positionOverlay() {
  const rect = elements.promptInput.getBoundingClientRect();
  slashOverlay.style.left = `${rect.left}px`;
  slashOverlay.style.top = `${rect.top - 8 - 240}px`;
  slashOverlay.style.width = `${rect.width}px`;
}

function refreshSlashSelection() {
  if (!slashOverlay) return;
  [...slashOverlay.children].forEach((c, idx) => {
    c.setAttribute("aria-selected", idx === slashIndex ? "true" : "false");
  });
}

function moveSlashSelection(delta) {
  slashIndex = (slashIndex + delta + slashItems.length) % slashItems.length;
  refreshSlashSelection();
}

function applySlashSelection() {
  const item = slashItems[slashIndex];
  if (!item) return;
  const text = elements.promptInput.value;
  const m = text.match(/(^|\n)(\/\w*)$/);
  if (!m) { closeSlashSuggestions(); return; }
  const before = text.slice(0, m.index + m[1].length);
  const replaced = `${before}${item.body} `;
  setComposerValue(replaced);
  closeSlashSuggestions();
}

function closeSlashSuggestions() {
  slashOpen = false;
  if (slashOverlay) slashOverlay.remove();
  slashOverlay = null;
  slashItems = [];
}

function applySlashCommandExpansion(text) {
  // exact match: line starts with /<id> alone
  const slash = store?.get("advanced.slashCommands") || [];
  for (const s of slash) {
    if (text === s.trigger) return s.expansion;
    if (text.startsWith(s.trigger + " ")) {
      return s.expansion + " " + text.slice(s.trigger.length + 1);
    }
  }
  return text;
}

export function setBusy(busy) {
  elements.sendButton.disabled = busy;
  elements.stopButton.hidden = !busy;
}
