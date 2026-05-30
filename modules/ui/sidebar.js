/* Sidebar: history list grouped by date, search, conversation actions. */

import { buildIndex, searchIndex, findSnippets, updateIndex, removeFromIndex } from "../search.js";

let elements = null;
let store = null;
let conversationStore = null;
let onSelect = null;
let onNew = null;
let onAction = null;
let allConversations = [];
let activeId = null;
let searchTerm = "";
let searchIndex_ = new Map(); // inverted index for full-text search

/* ---------- semantic search state ---------- */
let conversationVectors = new Map(); // id → Float32Array
let semanticDebounceTimer = null;
let semanticAbortController = null;
let getEmbedConfig = null; // () => { baseUrl, apiKey, model } | null

export function setEmbedConfig(cfg) {
  getEmbedConfig = typeof cfg === "function" ? cfg : () => cfg;
}

/* Build the text to embed for a conversation */
function textForConversation(conv) {
  const title = conv.title || "";
  const messages = (conv.messages || [])
    .slice(0, 20)
    .map((m) => m.content || "")
    .join("\n");
  return `${title}\n${messages}`.slice(0, 4000);
}

/* Cosine similarity between two Float32Arrays (assumed L2-normalised) */
function dotProduct(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

/* Embed a single text via the RAG embedder endpoint */
async function embedText(text, cfg, signal) {
  const res = await fetch("/api/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      input: text,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Invalid embedding response");
  // L2-normalise
  const arr = new Float32Array(vec);
  let norm = 0;
  for (const v of arr) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < arr.length; i++) arr[i] /= norm;
  return arr;
}

async function runSemanticSearch(query) {
  const cfg = getEmbedConfig?.();
  if (!cfg?.model || !cfg?.baseUrl) {
    // No embedding config — fall back to text search
    elements.historySearch.removeAttribute("data-search-mode");
    renderList();
    return;
  }

  // Cancel any in-flight request
  if (semanticAbortController) semanticAbortController.abort();
  semanticAbortController = new AbortController();
  const signal = semanticAbortController.signal;

  elements.historySearch.dataset.searchMode = "semantic";

  try {
    // Index conversations not yet vectorised
    const toIndex = allConversations.filter((c) => !conversationVectors.has(c.id));
    for (const conv of toIndex) {
      if (signal.aborted) return;
      try {
        const vec = await embedText(textForConversation(conv), cfg, signal);
        conversationVectors.set(conv.id, vec);
      } catch {
        // Skip this conversation if embedding fails
      }
    }

    if (signal.aborted) return;

    // Embed the query
    const queryVec = await embedText(query, cfg, signal);

    if (signal.aborted) return;

    // Score all conversations
    const THRESHOLD = 0.35;
    const scored = allConversations
      .map((c) => {
        const vec = conversationVectors.get(c.id);
        const score = vec ? dotProduct(queryVec, vec) : -1;
        return { conv: c, score };
      })
      .filter((r) => r.score >= THRESHOLD)
      .sort((a, b) => b.score - a.score);

    renderSemanticResults(scored.map((r) => r.conv));
  } catch (err) {
    if (err.name === "AbortError") return;
    // Any other error → silent fallback to text search
    elements.historySearch.removeAttribute("data-search-mode");
    renderList();
  }
}

function renderSemanticResults(conversations) {
  elements.historyList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("li");
    empty.className = "history-group-label";
    empty.textContent = "Sem resultados semânticos";
    elements.historyList.appendChild(empty);
    return;
  }
  const label = document.createElement("li");
  label.className = "history-group-label";
  label.textContent = "Resultados semânticos";
  elements.historyList.appendChild(label);
  for (const c of conversations) {
    elements.historyList.appendChild(renderItem(c));
  }
}

export function initSidebar(opts) {
  elements = opts.elements;
  store = opts.store;
  conversationStore = opts.conversationStore;
  onSelect = opts.onSelect || (() => {});
  onNew = opts.onNew || (() => {});
  onAction = opts.onAction || (() => {});
  if (opts.getEmbedConfig) getEmbedConfig = opts.getEmbedConfig;

  elements.newChatButton.addEventListener("click", () => onNew());
  elements.historySearch.addEventListener("input", () => {
    const raw = elements.historySearch.value;
    searchTerm = raw.toLowerCase().trim();

    // Clear any pending semantic search
    if (semanticDebounceTimer) { clearTimeout(semanticDebounceTimer); semanticDebounceTimer = null; }
    if (semanticAbortController) { semanticAbortController.abort(); semanticAbortController = null; }

    if (!searchTerm) {
      elements.historySearch.removeAttribute("data-search-mode");
      renderList();
      return;
    }

    const cfg = getEmbedConfig?.();
    if (searchTerm.length >= 3 && cfg?.model && cfg?.baseUrl) {
      // Semantic search with debounce
      elements.historySearch.dataset.searchMode = "semantic";
      semanticDebounceTimer = setTimeout(() => {
        runSemanticSearch(searchTerm);
      }, 400);
    } else {
      // Plain text search
      elements.historySearch.removeAttribute("data-search-mode");
      renderList();
    }
  });
}

export async function refreshSidebar() {
  allConversations = await conversationStore.list();
  allConversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // Invalidate vectors for conversations that no longer exist
  const ids = new Set(allConversations.map((c) => c.id));
  for (const id of conversationVectors.keys()) {
    if (!ids.has(id)) conversationVectors.delete(id);
  }
  // Rebuild inverted index for full-text search
  searchIndex_ = buildIndex(allConversations);
  renderList();
}

export function setActiveConversation(id) {
  activeId = id;
  renderList();
}

export function toggleSidebar() {
  const open = elements.sidebar.getAttribute("data-open") === "true";
  elements.sidebar.setAttribute("data-open", open ? "false" : "true");
}

export function closeSidebar() {
  elements.sidebar.setAttribute("data-open", "false");
}

function renderList() {
  if (elements.historySearch) {
    elements.historySearch.hidden = allConversations.length === 0 && !searchTerm;
  }
  let filtered;
  if (searchTerm && searchIndex_.size > 0) {
    const allIds = allConversations.map((c) => c.id);
    const matchIds = searchIndex(searchIndex_, searchTerm, allIds);
    const matchSet = new Set(matchIds);
    const idToConv = new Map(allConversations.map((c) => [c.id, c]));
    filtered = matchIds.filter((id) => idToConv.has(id)).map((id) => idToConv.get(id));
  } else if (searchTerm) {
    filtered = allConversations.filter((c) => {
      if (c.title?.toLowerCase().includes(searchTerm)) return true;
      return c.messages?.some((m) => m.content?.toLowerCase().includes(searchTerm));
    });
  } else {
    filtered = allConversations;
  }

  const groups = groupByDate(filtered);
  elements.historyList.replaceChildren();

  // Show search result count when searching
  if (searchTerm && filtered.length > 0) {
    const countLabel = document.createElement("li");
    countLabel.className = "history-group-label";
    countLabel.style.color = "var(--accent)";
    countLabel.textContent = `${filtered.length} resultado(s)`;
    elements.historyList.appendChild(countLabel);
  }

  for (const [label, items] of groups) {
    if (!items.length) continue;
    const groupLabel = document.createElement("li");
    groupLabel.className = "history-group-label";
    groupLabel.textContent = label;
    elements.historyList.appendChild(groupLabel);
    for (const c of items) {
      const li = renderItem(c);
      // Show snippet when searching
      if (searchTerm) {
        const snippets = findSnippets(c, searchTerm, 1);
        if (snippets.length) {
          const snippetEl = document.createElement("div");
          snippetEl.className = "history-item-snippet";
          snippetEl.textContent = snippets[0].snippet;
          const contentCol = li.querySelector(".history-item-content");
          if (contentCol) contentCol.appendChild(snippetEl);
        }
      }
      elements.historyList.appendChild(li);
    }
  }
  if (!filtered.length) {
    const empty = document.createElement("li");
    empty.className = searchTerm ? "history-group-label" : "sidebar-empty";
    empty.textContent = searchTerm ? "Sem resultados" : "Sem conversas";
    elements.historyList.appendChild(empty);
  }
}

function renderItem(conv) {
  const li = document.createElement("li");
  const item = document.createElement("button");
  item.type = "button";
  item.className = "history-item";
  if (conv.id === activeId) item.classList.add("active");

  const title = document.createElement("span");
  title.className = "history-item-title";
  title.textContent = conv.title || "(sem título)";

  const menu = document.createElement("span");
  menu.className = "history-item-menu";
  menu.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="6" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="18" r="1"></circle></svg>';

  const contentCol = document.createElement("div");
  contentCol.className = "history-item-content";
  contentCol.appendChild(title);

  item.appendChild(contentCol);
  item.appendChild(menu);

  item.addEventListener("click", (e) => {
    if (e.target.closest(".history-item-menu")) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(conv, menu, title);
      return;
    }
    onSelect(conv.id);
  });

  li.appendChild(item);
  return li;
}

function handleRenameAction(conv, titleEl) {
  const originalTitle = conv.title || "";
  let committed = false;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "history-item-rename";
  input.value = originalTitle;

  titleEl.replaceWith(input);

  // Prevent key/click events from bubbling to the parent .history-item button
  input.addEventListener("keyup", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());

  // Focus and select all text for easy replacement
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  const commit = async () => {
    if (committed) return;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== originalTitle) {
      committed = true;
      conv.title = newTitle;
      conv.updatedAt = Date.now();
      try {
        await conversationStore.upsert(conv);
        onAction({ action: "rename-done", conversation: conv });
      } catch (err) {
        // Revert on error
        conv.title = originalTitle;
        conv.updatedAt = conv.updatedAt;
      }
    } else {
      committed = true;
    }
    refreshSidebar();
  };

  const cancel = () => {
    committed = true;
    refreshSidebar();
  };

  input.addEventListener("keydown", (e) => {
    // Stop ALL key events from bubbling to the parent button
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });

  input.addEventListener("blur", () => {
    if (!committed) {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== originalTitle) {
        commit();
      } else {
        cancel();
      }
    }
  });
}

function openMenu(conv, anchor, titleEl) {
  const existing = document.getElementById("conv-menu");
  if (existing) existing.remove();
  const menu = document.createElement("div");
  menu.id = "conv-menu";
  menu.className = "palette-list";
  menu.style.position = "absolute";
  menu.style.background = "var(--bg-0)";
  menu.style.border = "1px solid var(--line)";
  menu.style.borderRadius = "var(--r-md)";
  menu.style.padding = "var(--s-1)";
  menu.style.boxShadow = "var(--shadow-2)";
  menu.style.zIndex = "20";
  menu.style.minWidth = "180px";

  for (const [act, label] of [
    ["rename", "Renomear"],
    ["save-template", "Salvar como template"],
    ["export-json", "Exportar JSON"],
    ["export-md", "Exportar Markdown"],
    ["export-html", "Exportar HTML"],
    ["delete", "Excluir"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "palette-item";
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.textContent = label;
    if (act === "delete") b.style.color = "var(--danger)";
    b.addEventListener("click", () => {
      menu.remove();
      if (act === "rename") {
        // Use the titleEl passed directly from renderItem — no DOM search needed
        const currentTitleEl = titleEl?.isConnected ? titleEl : null;
        if (currentTitleEl) {
          handleRenameAction(conv, currentTitleEl);
        } else {
          // Fallback: trigger via onAction if element was removed from DOM
          onAction({ action: act, conversation: conv });
        }
      } else {
        onAction({ action: act, conversation: conv });
      }
    });
    menu.appendChild(b);
  }

  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  document.body.appendChild(menu);

  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", close, true);
    }
  };
  setTimeout(() => document.addEventListener("click", close, true), 0);
}

function groupByDate(items) {
  const today = [];
  const week = [];
  const older = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const c of items) {
    const age = now - (c.updatedAt || 0);
    if (age < dayMs) today.push(c);
    else if (age < 7 * dayMs) week.push(c);
    else older.push(c);
  }
  return [
    ["Hoje", today],
    ["Esta semana", week],
    ["Anterior", older],
  ];
}
