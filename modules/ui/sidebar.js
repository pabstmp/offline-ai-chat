/* Sidebar: history list grouped by date, search, conversation actions. */

let elements = null;
let store = null;
let conversationStore = null;
let onSelect = null;
let onNew = null;
let onAction = null;
let allConversations = [];
let activeId = null;
let searchTerm = "";

export function initSidebar(opts) {
  elements = opts.elements;
  store = opts.store;
  conversationStore = opts.conversationStore;
  onSelect = opts.onSelect || (() => {});
  onNew = opts.onNew || (() => {});
  onAction = opts.onAction || (() => {});

  elements.newChatButton.addEventListener("click", () => onNew());
  elements.historySearch.addEventListener("input", () => {
    searchTerm = elements.historySearch.value.toLowerCase().trim();
    renderList();
  });
}

export async function refreshSidebar() {
  allConversations = await conversationStore.list();
  allConversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
  const filtered = allConversations.filter((c) => {
    if (!searchTerm) return true;
    if (c.title?.toLowerCase().includes(searchTerm)) return true;
    return c.messages?.some((m) => m.content?.toLowerCase().includes(searchTerm));
  });

  const groups = groupByDate(filtered);
  elements.historyList.replaceChildren();
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const groupLabel = document.createElement("li");
    groupLabel.className = "history-group-label";
    groupLabel.textContent = label;
    elements.historyList.appendChild(groupLabel);
    for (const c of items) {
      elements.historyList.appendChild(renderItem(c));
    }
  }
  if (!filtered.length) {
    const empty = document.createElement("li");
    empty.className = "history-group-label";
    empty.textContent = searchTerm ? "Sem resultados" : "Nenhuma conversa ainda";
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

  item.appendChild(title);
  item.appendChild(menu);

  item.addEventListener("click", (e) => {
    if (e.target.closest(".history-item-menu")) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(conv, menu);
      return;
    }
    onSelect(conv.id);
  });

  li.appendChild(item);
  return li;
}

function openMenu(conv, anchor) {
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
    ["export-json", "Exportar JSON"],
    ["export-md", "Exportar Markdown"],
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
      onAction({ action: act, conversation: conv });
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
