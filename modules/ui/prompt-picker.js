/* Prompt Picker modal: a dedicated dialog for searching and picking prompts from the library. */

let dialog = null;
let input = null;
let list = null;
let preview = null;
let allPrompts = [];
let filteredPrompts = [];
let selectedIndex = 0;
let onSelect = null;

export function initPromptPicker() {
  if (dialog) return;

  dialog = document.createElement("dialog");
  dialog.className = "prompt-picker palette";
  dialog.setAttribute("aria-label", "Biblioteca de Prompts");

  // Custom CSS for this dialog layout
  dialog.style.width = "600px";
  dialog.style.display = "flex";
  dialog.style.flexDirection = "column";

  input = document.createElement("input");
  input.type = "text";
  input.className = "palette-input";
  input.placeholder = "Buscar prompt por nome, ID ou conteúdo...";
  input.autocomplete = "off";

  const mainArea = document.createElement("div");
  mainArea.style.display = "flex";
  mainArea.style.flex = "1";
  mainArea.style.minHeight = "200px";

  list = document.createElement("ul");
  list.className = "palette-list";
  list.setAttribute("role", "listbox");
  list.style.flex = "1";
  list.style.maxHeight = "300px";
  list.style.overflowY = "auto";
  list.style.borderRight = "1px solid var(--line)";

  preview = document.createElement("div");
  preview.className = "prompt-picker-preview";
  preview.style.flex = "1";
  preview.style.padding = "var(--s-3)";
  preview.style.fontSize = "var(--fs-sm)";
  preview.style.color = "var(--fg-1)";
  preview.style.whiteSpace = "pre-wrap";
  preview.style.overflowY = "auto";
  preview.style.background = "var(--bg-2)";

  mainArea.appendChild(list);
  mainArea.appendChild(preview);

  dialog.appendChild(input);
  dialog.appendChild(mainArea);
  document.body.appendChild(dialog);

  input.addEventListener("input", () => {
    filter(input.value);
    renderList();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); execute(); }
    else if (e.key === "Escape") { e.preventDefault(); closePromptPicker(); }
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closePromptPicker();
  });
}

export function openPromptPicker(store, selectCallback) {
  if (!dialog) initPromptPicker();
  allPrompts = store.get("advanced.promptLibrary") || [];
  filteredPrompts = [...allPrompts];
  selectedIndex = 0;
  input.value = "";
  onSelect = selectCallback;
  
  if (!allPrompts.length) {
    preview.textContent = "Nenhum prompt salvo. Adicione prompts nas configurações → Avançado.";
  }
  
  renderList();
  dialog.showModal();
  input.focus();
}

export function closePromptPicker() {
  if (dialog?.open) dialog.close();
}

function filter(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    filteredPrompts = [...allPrompts];
  } else {
    filteredPrompts = allPrompts.filter(p => 
      (p.name || "").toLowerCase().includes(q) ||
      (p.id || "").toLowerCase().includes(q) ||
      (p.body || "").toLowerCase().includes(q)
    );
  }
  selectedIndex = 0;
}

function renderList() {
  list.replaceChildren();
  filteredPrompts.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "palette-item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    
    const icon = document.createElement("span");
    icon.textContent = "📚";
    li.appendChild(icon);
    
    const labelCol = document.createElement("div");
    labelCol.style.display = "flex";
    labelCol.style.flexDirection = "column";
    labelCol.style.flex = "1";
    labelCol.style.minWidth = "0";
    
    const label = document.createElement("span");
    label.textContent = p.name;
    label.style.fontWeight = "500";
    labelCol.appendChild(label);
    
    const hint = document.createElement("span");
    hint.style.color = "var(--fg-2)";
    hint.style.fontSize = "var(--fs-xs)";
    hint.style.fontFamily = "var(--font-mono)";
    hint.textContent = `/${p.id}`;
    labelCol.appendChild(hint);
    
    li.appendChild(labelCol);
    
    // Tags
    if (p.tags && p.tags.length) {
      const tags = document.createElement("div");
      tags.style.display = "flex";
      tags.style.gap = "4px";
      p.tags.slice(0, 2).forEach(t => {
        const tEl = document.createElement("span");
        tEl.textContent = t;
        tEl.style.fontSize = "10px";
        tEl.style.padding = "2px 4px";
        tEl.style.background = "var(--bg-3)";
        tEl.style.borderRadius = "4px";
        tags.appendChild(tEl);
      });
      li.appendChild(tags);
    }
    
    li.addEventListener("click", () => {
      selectedIndex = idx;
      execute();
    });
    li.addEventListener("mouseenter", () => {
      selectedIndex = idx;
      refreshSelection();
    });
    list.appendChild(li);
  });
  updatePreview();
}

function refreshSelection() {
  [...list.children].forEach((el, idx) => {
    el.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    if (idx === selectedIndex) el.scrollIntoView({ block: "nearest" });
  });
  updatePreview();
}

function updatePreview() {
  const p = filteredPrompts[selectedIndex];
  if (!p) {
    preview.textContent = allPrompts.length ? "" : "Nenhum prompt salvo. Adicione prompts nas configurações → Avançado.";
    return;
  }
  let text = p.body || "";
  if (text.length > 300) text = text.slice(0, 300) + "…";
  preview.textContent = text;
}

function move(delta) {
  if (!filteredPrompts.length) return;
  selectedIndex = (selectedIndex + delta + filteredPrompts.length) % filteredPrompts.length;
  refreshSelection();
}

function execute() {
  const p = filteredPrompts[selectedIndex];
  if (p && onSelect) {
    closePromptPicker();
    onSelect(p.body);
  }
}
