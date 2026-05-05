/* Shared state + DOM helpers for the Settings drawer.
   Each panel imports `state` for callbacks/store access and the
   small primitive helpers below for consistent UI. */

export const state = {
  elements: null,
  store: null,
  onChange: () => {},
  onConnect: () => {},
  onLoadModels: () => {},
  onProfileChange: () => {},
  activeTab: "server",
  rebuildPanel: () => {},
  conversationStore: null,
  toast: () => {},
  refreshSidebar: () => {},
};

export function field(label, child, help) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  if (label) {
    const l = document.createElement("label");
    l.className = "field-label";
    l.textContent = label;
    if (child.id) l.htmlFor = child.id;
    wrap.appendChild(l);
  }
  wrap.appendChild(child);
  if (help) {
    const h = document.createElement("p");
    h.className = "field-help";
    h.textContent = help;
    wrap.appendChild(h);
  }
  return wrap;
}

export function section(title) {
  const s = document.createElement("section");
  s.className = "drawer-section";
  if (title) {
    const h = document.createElement("h3");
    h.className = "drawer-section-title";
    h.textContent = title;
    s.appendChild(h);
  }
  return s;
}

export function input(opts) {
  const i = document.createElement("input");
  for (const [k, v] of Object.entries(opts)) {
    if (k.startsWith("on")) i.addEventListener(k.slice(2), v);
    else if (k === "style") i.setAttribute("style", v);
    else i[k] = v;
  }
  return i;
}

export function select(options, value) {
  const s = document.createElement("select");
  for (const o of options) {
    const opt = new Option(o.label, o.value);
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

export function checkbox(label, checked, onToggle) {
  const wrap = document.createElement("label");
  wrap.className = "checkbox-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!checked;
  cb.addEventListener("change", () => onToggle(cb.checked));
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(cb);
  wrap.appendChild(span);
  return wrap;
}

export function button(label, kind, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn ${kind || "btn-secondary"}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export function card(content) {
  const c = document.createElement("div");
  c.className = "drawer-card";
  if (Array.isArray(content)) for (const node of content) c.appendChild(node);
  else c.appendChild(content);
  return c;
}

/* Updates the cached model list shown in dropdowns (profiles tab,
   embedding-model chips in workspace tab). Called by app.js after
   loadModels() to keep UI in sync with what the server has. */
export function setModelOptions(models) {
  if (!state.elements) return;
  state.elements.modelOptions = Array.isArray(models) ? models.slice() : [];
}

export function getActiveProfile() {
  const profiles = state.store.get("profiles");
  const id = state.store.get("activeProfileId");
  return profiles.find((p) => p.id === id) || profiles[0];
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
