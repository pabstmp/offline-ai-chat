/* Composer: textarea auto-resize (guarded), token estimator, slash command
   suggestions overlay, send/stop button management. */

import { estimateTokens } from "../markdown.js";
import { openPromptPicker } from "./prompt-picker.js";

/* ---------- pure functions (re-exported from composer-helpers.js for testability) ---------- */
export { validateImageSize, buildImageMessageContent } from "./composer-helpers.js";

import { validateImageSize, buildImageMessageContent } from "./composer-helpers.js";

let elements = null;
let store = null;
let onSubmit = null;
let onSlashSelect = null;
let lastLength = -1;
let actionMenu = null;

/* ---------- pending image state ---------- */
let pendingImage = null; // { base64, mimeType, name } | null

export function getPendingImage() {
  return pendingImage;
}

export function clearPendingImage() {
  pendingImage = null;
  // Remove preview from DOM if present
  const preview = document.getElementById("composer-image-preview");
  if (preview) preview.remove();
}

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
    if (!text && !pendingImage) return;
    text = applySlashCommandExpansion(text);
    onSubmit(text);
  });

  initAttachmentActions();

  // Image drag-drop on composer area
  initComposerDropZone();
}

/* ---------- composer image drop zone ---------- */

function initComposerDropZone() {
  const frame = elements.chatForm.querySelector(".composer-frame") || elements.chatForm;
  let dragCounter = 0;

  frame.addEventListener("dragenter", (e) => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
    dragCounter++;
    frame.classList.add("drop-active");
  });

  frame.addEventListener("dragover", (e) => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  frame.addEventListener("dragleave", (e) => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      frame.classList.remove("drop-active");
    }
  });

  frame.addEventListener("drop", (e) => {
    dragCounter = 0;
    frame.classList.remove("drop-active");
    if (!hasImageFile(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) handleImageFile(file);
  });
}

function hasImageFile(e) {
  if (e.dataTransfer?.types?.includes("Files")) {
    // Check items if available
    const items = e.dataTransfer.items;
    if (items) {
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) return true;
      }
    }
    return true; // can't determine type on dragenter, assume yes
  }
  return false;
}

/* ---------- image upload ---------- */

function initAttachmentActions() {
  if (!elements.attachButton) return;
  elements.attachButton.setAttribute("aria-haspopup", "menu");
  elements.attachButton.setAttribute("aria-expanded", "false");
  elements.attachButton.title = "Anexos e prompts";
  elements.attachButton.setAttribute("aria-label", "Anexos e prompts");
  elements.attachButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleActionMenu();
  });
}

function toggleActionMenu(forceOpen = null) {
  const shouldOpen = forceOpen === null ? !actionMenu : forceOpen;
  if (!shouldOpen) {
    closeActionMenu();
    return;
  }
  openActionMenu();
}

function closeActionMenu() {
  if (actionMenu) actionMenu.remove();
  actionMenu = null;
  elements.attachButton?.setAttribute("aria-expanded", "false");
}

function openActionMenu() {
  closeActionMenu();
  actionMenu = document.createElement("div");
  actionMenu.id = "composerActionMenu";
  actionMenu.className = "composer-action-menu";
  actionMenu.setAttribute("role", "menu");

  const items = [
    {
      label: "Arquivo",
      hint: "Ctrl+U",
      icon: `<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`,
      run: () => document.dispatchEvent(new CustomEvent("composer:attach-file")),
    },
    {
      label: "Imagem",
      hint: "PNG, JPG, GIF, WebP",
      icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
      run: pickImageFile,
    },
    {
      label: "Prompt salvo",
      hint: "Ctrl+Shift+P",
      icon: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>`,
      run: () => openPromptPicker(store, insertPromptText),
    },
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "composer-action-item";
    btn.setAttribute("role", "menuitem");
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
      <span class="composer-action-label">${item.label}</span>
      <span class="composer-action-hint">${item.hint}</span>
    `;
    btn.addEventListener("click", () => {
      closeActionMenu();
      item.run();
    });
    actionMenu.appendChild(btn);
  }

  document.body.appendChild(actionMenu);
  const rect = elements.attachButton.getBoundingClientRect();
  const width = 250;
  actionMenu.style.width = `${width}px`;
  actionMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  actionMenu.style.top = `${Math.max(8, rect.top - actionMenu.offsetHeight - 8)}px`;
  elements.attachButton.setAttribute("aria-expanded", "true");

  const close = (e) => {
    if (!actionMenu) return;
    if (actionMenu.contains(e.target) || e.target === elements.attachButton) return;
    closeActionMenu();
    document.removeEventListener("click", close, true);
  };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    closeActionMenu();
    document.removeEventListener("keydown", onKey, true);
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
  document.addEventListener("keydown", onKey, true);
}

function addPromptPickerButton() {
  if (!elements.attachButton) return;
  if (document.getElementById("promptPickerButton")) return;

  const btn = document.createElement("button");
  btn.id = "promptPickerButton";
  btn.type = "button";
  btn.className = "icon-button";
  btn.style.width = "28px";
  btn.style.height = "28px";
  btn.setAttribute("aria-label", "Biblioteca de Prompts (Ctrl+Shift+P)");
  btn.title = "Biblioteca de Prompts (Ctrl+Shift+P)";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;

  btn.addEventListener("click", () => {
    openPromptPicker(store, (text) => {
      insertPromptText(text);
    });
  });

  elements.attachButton.insertAdjacentElement("afterend", btn);
}

export function insertPromptText(text) {
  const ta = elements.promptInput;
  if (ta.value.trim()) {
    ta.value += "\n" + text;
  } else {
    ta.value = text;
  }
  ta.focus();
  lastLength = -1;
  autoResize();
  updateTokenCount();
}

function addImageUploadButton() {
  if (!elements.attachButton) return;
  // Don't add twice
  if (document.getElementById("imageUploadButton")) return;

  const btn = document.createElement("button");
  btn.id = "imageUploadButton";
  btn.type = "button";
  btn.className = "icon-button";
  btn.style.width = "28px";
  btn.style.height = "28px";
  btn.setAttribute("aria-label", "Anexar imagem");
  btn.title = "Anexar imagem";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

  btn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/png,image/jpeg,image/gif,image/webp";
    inp.addEventListener("change", () => {
      const file = inp.files[0];
      if (!file) return;
      handleImageFile(file);
    });
    inp.click();
  });

  // Insert after attachButton
  elements.attachButton.insertAdjacentElement("afterend", btn);
}

function pickImageFile() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/png,image/jpeg,image/gif,image/webp";
  inp.addEventListener("change", () => {
    const file = inp.files[0];
    if (!file) return;
    handleImageFile(file);
  });
  inp.click();
}

function handleImageFile(file) {
  const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    // toast is not available here — use a custom event or just skip
    console.warn("Tipo de imagem não suportado:", file.type);
    return;
  }
  if (!validateImageSize(file.size)) {
    // Signal error via a custom event that app.js can listen to
    document.dispatchEvent(new CustomEvent("composer:image-error", {
      detail: { message: "Imagem muito grande. Limite: 10 MB." }
    }));
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Extract base64 data (remove "data:mime;base64," prefix)
    const base64 = dataUrl.split(",")[1];
    pendingImage = { base64, mimeType: file.type, name: file.name };
    showImagePreview(dataUrl);
  };
  reader.onerror = () => {
    document.dispatchEvent(new CustomEvent("composer:image-error", {
      detail: { message: "Erro ao ler imagem." }
    }));
  };
  reader.readAsDataURL(file);
}

function showImagePreview(dataUrl) {
  // Remove existing preview
  const existing = document.getElementById("composer-image-preview");
  if (existing) existing.remove();

  const preview = document.createElement("div");
  preview.id = "composer-image-preview";
  preview.className = "composer-image-preview";

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Preview da imagem";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "composer-image-preview-remove";
  removeBtn.setAttribute("aria-label", "Remover imagem");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => clearPendingImage());

  preview.appendChild(img);
  preview.appendChild(removeBtn);

  // Insert before the textarea inside composer-frame
  const frame = elements.chatForm.querySelector(".composer-frame");
  if (frame) {
    frame.insertBefore(preview, frame.firstChild);
  }
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
