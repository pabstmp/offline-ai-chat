import { defaultKeymap } from "../../schema.js";
import { captureChord } from "../../shortcuts.js";
import { state, section, button } from "./_shared.js";

export function panelShortcuts() {
  const { store, elements, onChange, rebuildPanel } = state;
  const km = store.get("keymap");
  const sec = section("Atalhos de teclado");
  const labels = {
    send: "Enviar mensagem",
    newLine: "Nova linha",
    newChat: "Nova conversa",
    toggleSidebar: "Alternar histórico",
    openSettings: "Abrir configurações",
    openPalette: "Paleta de comandos",
    focusComposer: "Focar composer",
    stopStream: "Parar geração",
    nextProfile: "Próximo perfil",
    toggleZen: "Modo zen",
    attachFile: "Anexar arquivo",
    quickOpen: "Quick open arquivo",
    toggleWorkspace: "Sidebar workspace",
  };

  const c = document.createElement("div");
  c.className = "drawer-card";

  for (const [action, binding] of Object.entries(km)) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.padding = "var(--s-2) 0";
    row.style.borderBottom = "1px solid var(--line)";
    const lbl = document.createElement("div");
    lbl.style.flex = "1";
    lbl.textContent = labels[action] || action;
    const chord = document.createElement("kbd");
    chord.textContent = binding;
    chord.style.minWidth = "100px";
    chord.style.textAlign = "center";
    const btn = button("Reconfigurar", "btn-ghost", async () => {
      btn.textContent = "Pressione…";
      btn.disabled = true;
      const next = await captureChord();
      btn.disabled = false;
      btn.textContent = "Reconfigurar";
      if (next) {
        km[action] = next;
        chord.textContent = next;
        store.set("keymap", { ...km });
        onChange();
      }
    });
    btn.classList.add("btn-sm");
    row.appendChild(lbl);
    row.appendChild(chord);
    row.appendChild(btn);
    c.appendChild(row);
  }

  sec.appendChild(c);
  sec.appendChild(button("Resetar atalhos para padrão", "btn-ghost", () => {
    store.set("keymap", defaultKeymap());
    onChange();
    rebuildPanel("shortcuts");
  }));
  elements.settingsBody.appendChild(sec);
}
