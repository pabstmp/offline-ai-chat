import { state, section, field, input, select, checkbox, card, button } from "./_shared.js";

export function panelBehavior() {
  const { store, elements, onChange } = state;
  const b = store.get("behavior");
  const sec = section("Comportamento");
  const c = document.createElement("div");
  c.className = "drawer-card";

  c.appendChild(field("Tecla de envio", (() => {
    const s = select(
      [{ value: "enter", label: "Enter envia · Shift+Enter quebra linha" }, { value: "ctrl-enter", label: "Ctrl/Cmd+Enter envia" }],
      b.submitOn
    );
    s.addEventListener("change", () => { b.submitOn = s.value; onChange(); });
    return s;
  })()));
  c.appendChild(checkbox("Persistir conversas em localStorage/IndexedDB", b.persistConversations, (v) => { b.persistConversations = v; onChange(); }));
  c.appendChild(checkbox("Confirmar antes de excluir", b.confirmOnDelete, (v) => { b.confirmOnDelete = v; onChange(); }));

  sec.appendChild(c);
  elements.settingsBody.appendChild(sec);

  const danger = section("Zona de perigo");
  danger.appendChild(card([
    button("Limpar todo o storage do app", "btn-danger", async () => {
      if (!confirm("Apagar TODAS as configurações e conversas?\nIsso não pode ser desfeito.")) return;
      localStorage.clear();
      try {
        const dbs = await indexedDB.databases?.();
        for (const d of dbs || []) indexedDB.deleteDatabase(d.name);
      } catch {}
      location.reload();
    }),
  ]));
  elements.settingsBody.appendChild(danger);
}
