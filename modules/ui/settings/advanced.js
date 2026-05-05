import { toast } from "../toasts.js";
import { state, section, input, checkbox, button, downloadJson } from "./_shared.js";
import { templateStore, removeTemplate } from "../../templates.js";

export function panelAdvanced() {
  const { store, elements, onChange, rebuildPanel } = state;
  const adv = store.get("advanced");

  const sec = section("Geração");
  const c = document.createElement("div");
  c.className = "drawer-card";
  c.appendChild(checkbox("Streaming (recomendado)", adv.streaming, (v) => { adv.streaming = v; onChange(); }));
  c.appendChild(checkbox("Modo debug — loga payload no console", adv.debugMode, (v) => { adv.debugMode = v; onChange(); }));
  sec.appendChild(c);
  elements.settingsBody.appendChild(sec);

  const slashSec = section("Slash commands");
  const slashHelp = document.createElement("p");
  slashHelp.className = "field-help";
  slashHelp.textContent = "Digite o trigger no início da mensagem (ou após uma quebra de linha) para abrir o autocompletar.";
  slashSec.appendChild(slashHelp);

  for (const sc of adv.slashCommands) {
    const row = document.createElement("div");
    row.className = "drawer-card";
    const inner = document.createElement("div");
    inner.className = "row";
    inner.appendChild(input({
      type: "text", value: sc.trigger, style: "width: 140px; font-family: var(--font-mono);",
      onchange: (e) => { sc.trigger = e.target.value.trim(); onChange(); },
    }));
    inner.appendChild(input({
      type: "text", value: sc.expansion, style: "flex: 1;", placeholder: "Texto que substitui o trigger",
      onchange: (e) => { sc.expansion = e.target.value; onChange(); },
    }));
    inner.appendChild(button("×", "btn-danger", () => {
      adv.slashCommands = adv.slashCommands.filter((x) => x !== sc);
      onChange();
      rebuildPanel("advanced");
    }));
    row.appendChild(inner);
    slashSec.appendChild(row);
  }
  slashSec.appendChild(button("+ Novo slash command", "btn-secondary", () => {
    adv.slashCommands.push({ trigger: "/novo", expansion: "" });
    onChange();
    rebuildPanel("advanced");
  }));
  elements.settingsBody.appendChild(slashSec);

  const libSec = section("Prompt library");
  for (const p of adv.promptLibrary) {
    const row = document.createElement("div");
    row.className = "drawer-card";

    const head = document.createElement("div");
    head.className = "row";
    head.appendChild(input({ type: "text", value: p.id, placeholder: "id", style: "width: 100px; font-family: var(--font-mono);",
      onchange: (e) => { p.id = e.target.value.trim(); onChange(); }
    }));
    head.appendChild(input({ type: "text", value: p.name, placeholder: "Nome", style: "flex: 1;",
      onchange: (e) => { p.name = e.target.value; onChange(); }
    }));
    head.appendChild(button("×", "btn-danger", () => {
      adv.promptLibrary = adv.promptLibrary.filter((x) => x !== p);
      onChange();
      rebuildPanel("advanced");
    }));
    row.appendChild(head);

    const body = document.createElement("textarea");
    body.rows = 2;
    body.value = p.body;
    body.addEventListener("change", () => { p.body = body.value; onChange(); });
    row.appendChild(body);

    libSec.appendChild(row);
  }
  libSec.appendChild(button("+ Novo snippet", "btn-secondary", () => {
    adv.promptLibrary.push({ id: `s-${Date.now()}`, name: "Novo", body: "", tags: [] });
    onChange();
    rebuildPanel("advanced");
  }));
  elements.settingsBody.appendChild(libSec);

  const ioSec = section("Backup");
  const ioCard = document.createElement("div");
  ioCard.className = "drawer-card";
  const ioRow = document.createElement("div");
  ioRow.className = "row";
  ioRow.appendChild(button("Exportar configurações", "btn-secondary", () =>
    downloadJson("offline-ai-settings.json", store.raw())
  ));
  ioRow.appendChild(button("Importar configurações", "btn-ghost", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed.schemaVersion) throw new Error("schemaVersion ausente");
        store.replace(parsed);
        onChange();
        toast("Importado. Recarregando…", "success");
        setTimeout(() => location.reload(), 800);
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
    inp.click();
  }));
  ioCard.appendChild(ioRow);
  ioSec.appendChild(ioCard);
  elements.settingsBody.appendChild(ioSec);

  // Templates de conversa
  const tplSec = section("Templates de conversa");
  const tplHelp = document.createElement("p");
  tplHelp.className = "field-help";
  tplHelp.textContent = "Salve conversas como templates para reutilizar contextos frequentes. Use o menu ⋮ de uma conversa no histórico para salvar.";
  tplSec.appendChild(tplHelp);

  function renderTemplateList() {
    const existing = tplSec.querySelector(".tpl-list");
    if (existing) existing.remove();
    const list = document.createElement("div");
    list.className = "tpl-list";
    const templates = templateStore.list();
    if (!templates.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "Nenhum template salvo ainda.";
      list.appendChild(empty);
    } else {
      for (const tpl of templates) {
        const row = document.createElement("div");
        row.className = "drawer-card";
        row.style.flexDirection = "row";
        row.style.alignItems = "center";
        row.style.gap = "var(--s-3)";
        const nameEl = document.createElement("span");
        nameEl.style.flex = "1";
        nameEl.style.fontWeight = "500";
        nameEl.textContent = tpl.name;
        const msgCount = document.createElement("span");
        msgCount.className = "field-help";
        msgCount.style.whiteSpace = "nowrap";
        msgCount.textContent = `${(tpl.messages || []).length} msg(s)`;
        const delBtn = button("×", "btn-danger", () => {
          const updated = removeTemplate(templateStore.list(), tpl.id);
          templateStore.save(updated);
          renderTemplateList();
        });
        row.appendChild(nameEl);
        row.appendChild(msgCount);
        row.appendChild(delBtn);
        list.appendChild(row);
      }
    }
    tplSec.appendChild(list);
  }

  renderTemplateList();
  elements.settingsBody.appendChild(tplSec);
}
