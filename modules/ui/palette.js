/* Command palette: dialog with input + filtered list. */

let dialog = null;
let input = null;
let list = null;
let allCommands = [];
let filteredCommands = [];
let selectedIndex = 0;

export function initPalette() {
  if (dialog) return;
  dialog = document.createElement("dialog");
  dialog.className = "palette";
  dialog.setAttribute("aria-label", "Paleta de comandos");

  input = document.createElement("input");
  input.type = "text";
  input.className = "palette-input";
  input.placeholder = "Digite um comando ou busque...";
  input.autocomplete = "off";

  list = document.createElement("ul");
  list.className = "palette-list";
  list.setAttribute("role", "listbox");

  dialog.appendChild(input);
  dialog.appendChild(list);
  document.body.appendChild(dialog);

  input.addEventListener("input", () => {
    filter(input.value);
    renderList();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); execute(); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closePalette();
  });
}

export function openPalette(commands) {
  if (!dialog) initPalette();
  allCommands = commands;
  filteredCommands = [...commands];
  selectedIndex = 0;
  input.value = "";
  renderList();
  dialog.showModal();
  input.focus();
}

export function closePalette() {
  if (dialog?.open) dialog.close();
}

function filter(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    filteredCommands = [...allCommands];
  } else {
    filteredCommands = allCommands
      .map((c) => ({ c, score: scoreMatch(c, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }
  selectedIndex = 0;
}

function scoreMatch(cmd, q) {
  const text = `${cmd.label} ${cmd.hint || ""}`.toLowerCase();
  if (!text.includes(q)) return 0;
  const idx = text.indexOf(q);
  return 100 - idx;
}

function renderList() {
  list.replaceChildren();
  filteredCommands.forEach((c, idx) => {
    const li = document.createElement("li");
    li.className = "palette-item";
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    if (c.icon) {
      const icon = document.createElement("span");
      icon.textContent = c.icon;
      li.appendChild(icon);
    }
    const label = document.createElement("span");
    label.style.flex = "1";
    label.textContent = c.label;
    li.appendChild(label);
    if (c.hint) {
      const hint = document.createElement("span");
      hint.style.color = "var(--fg-2)";
      hint.style.fontSize = "var(--fs-xs)";
      hint.textContent = c.hint;
      li.appendChild(hint);
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
}

function refreshSelection() {
  [...list.children].forEach((el, idx) => {
    el.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false");
    if (idx === selectedIndex) el.scrollIntoView({ block: "nearest" });
  });
}

function move(delta) {
  if (!filteredCommands.length) return;
  selectedIndex = (selectedIndex + delta + filteredCommands.length) % filteredCommands.length;
  refreshSelection();
}

function execute() {
  const cmd = filteredCommands[selectedIndex];
  if (cmd?.run) {
    closePalette();
    cmd.run();
  }
}
