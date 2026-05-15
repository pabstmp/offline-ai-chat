/* Settings — fullscreen modal (macOS-preferences style).
   Each tab has its own panel module under this folder. The shared
   state object in _shared.js is wired up here once and read by every
   panel; helpers (field, section, input, etc.) also live there. */

import { state, setModelOptions } from "./_shared.js";

export { setModelOptions };
import { panelServer } from "./server.js";
import { panelModel } from "./model.js";
import { panelAppearance } from "./appearance.js";
import { panelBehavior } from "./behavior.js";
import { panelProfiles } from "./profiles.js";
import { panelShortcuts } from "./shortcuts.js";
import { panelWorkspace } from "./workspace.js";
import { panelAdvanced } from "./advanced.js";
import { panelTools } from "./tools.js";

const ICONS = {
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><path d="M12 2a3 3 0 0 0-3 3v.5A3.5 3.5 0 0 0 5.5 9 3.5 3.5 0 0 0 4 11.85 3 3 0 0 0 6 17a3 3 0 0 0 3 3v0a3 3 0 0 0 3 0v0M12 2a3 3 0 0 1 3 3v.5A3.5 3.5 0 0 1 18.5 9 3.5 3.5 0 0 1 20 11.85 3 3 0 0 1 18 17a3 3 0 0 1-3 3v0a3 3 0 0 1-3 0v0"/></svg>',
  appearance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>',
  behavior: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  profiles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  shortcuts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg>',
  workspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  advanced: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="drawer-tab-icon"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"/></svg>',
};

const TABS = [
  ["server", "Servidor"],
  ["profiles", "Perfis & Inferência"],
  ["model", "Hardware"],
  ["workspace", "Workspace"],
  ["appearance", "Aparência"],
  ["behavior", "Comportamento"],
  ["shortcuts", "Atalhos"],
  ["tools", "Ferramentas"],
  ["advanced", "Avançado"],
];

export function initSettings(opts) {
  state.elements = opts.elements;
  state.store = opts.store;
  state.onChange = opts.onChange || (() => {});
  state.onConnect = opts.onConnect || (() => {});
  state.onLoadModels = opts.onLoadModels || (() => {});
  state.onProfileChange = opts.onProfileChange || (() => {});
  state.rebuildPanel = rebuildPanel;
  if (opts.conversationStore) state.conversationStore = opts.conversationStore;
  if (opts.toast) state.toast = opts.toast;
  if (opts.refreshSidebar) state.refreshSidebar = opts.refreshSidebar;

  buildTabs();
  rebuildPanel(state.activeTab);

  state.elements.settingsClose.addEventListener("click", closeSettings);
  state.elements.settingsDrawer.addEventListener("click", (e) => {
    if (e.target === state.elements.settingsDrawer) closeSettings();
  });
}

export function openSettings(tab = "server") {
  state.activeTab = tab;
  switchTab(tab);
  rebuildPanel(tab);
  state.elements.settingsDrawer.setAttribute("data-open", "true");
  state.elements.settingsDrawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

export function closeSettings() {
  state.elements.settingsDrawer.setAttribute("data-open", "false");
  state.elements.settingsDrawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function buildTabs() {
  state.elements.settingsTabs.replaceChildren();
  for (const [id, label] of TABS) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "drawer-tab";
    btn.dataset.tab = id;
    btn.role = "tab";
    btn.innerHTML = ICONS[id] || "";
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    if (id === state.activeTab) btn.classList.add("active");
    btn.addEventListener("click", () => { switchTab(id); rebuildPanel(id); });
    li.appendChild(btn);
    state.elements.settingsTabs.appendChild(li);
  }
}

function switchTab(id) {
  state.activeTab = id;
  [...state.elements.settingsTabs.querySelectorAll(".drawer-tab")].forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === id);
  });
  const titleEl = document.getElementById("drawerTitle");
  if (titleEl) {
    const found = TABS.find(([k]) => k === id);
    titleEl.textContent = found ? found[1] : id;
  }
}

function rebuildPanel(tabId) {
  state.elements.settingsBody.replaceChildren();
  switch (tabId) {
    case "server": panelServer(); break;
    case "model": panelModel(); break;
    case "appearance": panelAppearance(); break;
    case "behavior": panelBehavior(); break;
    case "profiles": panelProfiles(); break;
    case "shortcuts": panelShortcuts(); break;
    case "workspace": panelWorkspace(); break;
    case "tools": state.elements.settingsBody.appendChild(panelTools({ store: state.store, onChange: state.onChange })); break;
    case "advanced": panelAdvanced(); break;
  }
}
