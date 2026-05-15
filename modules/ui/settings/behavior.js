import { state, section, field, input, select, checkbox, card, button } from "./_shared.js";
import { isSupported as notificationsSupported, isBlocked as notificationsBlocked, requestNotificationPermission } from "../../notifications.js";

/* ---------- pure functions (exported for testing) ---------- */

export function backupFilename(date = new Date()) {
  const d = (date instanceof Date && !isNaN(date)) ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `offline-ai-backup-${y}-${m}-${day}.json`;
}

export function mergeConversations(existing, imported) {
  const existingIds = new Set(existing.map((c) => c.id));
  const toAdd = imported.filter((c) => !existingIds.has(c.id));
  return { merged: [...existing, ...toAdd], added: toAdd.length, skipped: imported.length - toAdd.length };
}

export function validateBackupFile(parsed) {
  if (!Array.isArray(parsed)) return { valid: false, reason: "não é um array" };
  if (parsed.length > 0 && typeof parsed[0].id !== "string") return { valid: false, reason: "itens sem campo id" };
  return { valid: true };
}

export function panelBehavior() {
  const { store, elements, onChange, conversationStore, toast, refreshSidebar } = state;
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

  // Notifications checkbox
  if (notificationsSupported()) {
    const blocked = notificationsBlocked();
    const notifPref = b.notifications || "disabled";
    const notifCb = checkbox(
      "Notificar quando o modelo terminar de responder",
      notifPref === "enabled" && !blocked,
      async (v) => {
        if (v) {
          const result = await requestNotificationPermission();
          if (result !== "granted") {
            // Revert checkbox
            const inp = notifCb.querySelector("input");
            if (inp) inp.checked = false;
            return;
          }
          b.notifications = "enabled";
        } else {
          b.notifications = "disabled";
        }
        onChange();
      }
    );
    if (blocked) {
      const inp = notifCb.querySelector("input");
      if (inp) inp.disabled = true;
      const hint = document.createElement("p");
      hint.className = "field-hint";
      hint.textContent = "Notificações bloqueadas pelo navegador. Altere nas configurações do browser para reativar.";
      notifCb.appendChild(hint);
    }
    c.appendChild(notifCb);
  }

  sec.appendChild(c);
  elements.settingsBody.appendChild(sec);

  // Backup de conversas
  const backupSec = section("Backup de conversas");
  const backupCard = document.createElement("div");
  backupCard.className = "drawer-card";
  const backupRow = document.createElement("div");
  backupRow.className = "row";

  backupRow.appendChild(button("Exportar tudo", "btn-secondary", async () => {
    try {
      const convs = await conversationStore.list();
      const json = JSON.stringify(convs, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFilename();
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      toast(`${convs.length} conversa(s) exportada(s).`, "success");
    } catch (err) {
      toast("Erro ao exportar: " + err.message, "error");
    }
  }));

  backupRow.appendChild(button("Importar backup", "btn-ghost", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const validation = validateBackupFile(parsed);
        if (!validation.valid) {
          toast(`Arquivo inválido: ${validation.reason}`, "error");
          return;
        }
        const existing = await conversationStore.list();
        const { merged, added, skipped } = mergeConversations(existing, parsed);
        for (const conv of merged) {
          if (parsed.some((c) => c.id === conv.id && !existing.some((e) => e.id === conv.id))) {
            await conversationStore.upsert(conv);
          }
        }
        // Upsert only the new ones
        const existingIds = new Set(existing.map((c) => c.id));
        for (const conv of parsed) {
          if (!existingIds.has(conv.id)) {
            await conversationStore.upsert(conv);
          }
        }
        await refreshSidebar();
        toast(`Importação concluída: ${added} adicionada(s), ${skipped} já existia(m).`, "success");
      } catch (err) {
        toast("Erro ao importar: " + err.message, "error");
      }
    });
    inp.click();
  }));

  backupCard.appendChild(backupRow);
  backupSec.appendChild(backupCard);
  elements.settingsBody.appendChild(backupSec);

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
