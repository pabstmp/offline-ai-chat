import { toast } from "../toasts.js";
import { state, section, input, checkbox, button, downloadJson } from "./_shared.js";
import { templateStore, removeTemplate } from "../../templates.js";

export function panelAdvanced() {
  const { store, elements, onChange, rebuildPanel } = state;
  const adv = store.get("advanced");

  const sec = section("Geração");
  const genDetails = document.createElement("details");
  genDetails.className = "advanced-settings-details";
  const genSummary = document.createElement("summary");
  genSummary.textContent = "Streaming e debug";
  genDetails.appendChild(genSummary);
  const c = document.createElement("div");
  c.className = "drawer-card";
  c.appendChild(checkbox("Streaming (recomendado)", adv.streaming, (v) => { adv.streaming = v; onChange(); }));
  c.appendChild(checkbox("Modo debug — loga payload no console", adv.debugMode, (v) => { adv.debugMode = v; onChange(); }));
  genDetails.appendChild(c);
  sec.appendChild(genDetails);
  elements.settingsBody.appendChild(sec);

  // Busca web — só aparece se o usuário quiser mexer. Default é DDG sem config.
  const searchSec = section("Busca web");
  searchSec.id = "advanced-search-section";

  const searchDetails = document.createElement("details");
  searchDetails.className = "advanced-settings-details";
  const searchSummary = document.createElement("summary");
  searchSummary.textContent = "Provedor de Busca (DuckDuckGo / Brave Search API)";
  searchDetails.appendChild(searchSummary);

  const searchCard = document.createElement("div");
  searchCard.className = "drawer-card";
  searchCard.style.marginTop = "var(--s-2)";
  const searchHelp = document.createElement("p");
  searchHelp.className = "field-help";
  searchHelp.innerHTML =
    'A busca web (tool <code>web_search</code>) usa DuckDuckGo por padrão — funciona sem nenhuma configuração. ' +
    'Se o DDG estiver bloqueando seu IP (anti-bot), cole abaixo uma chave gratuita do Brave Search ' +
    '(<a href="https://api.search.brave.com/app/keys" target="_blank" rel="noopener">api.search.brave.com</a>, ' +
    '2000 buscas/mês grátis, só precisa de email).';
  searchCard.appendChild(searchHelp);

  if (!adv.search) adv.search = { braveApiKey: "" };
  const keyInput = input({
    type: "password",
    value: adv.search.braveApiKey || "",
    placeholder: "BSA_xxxx (opcional — em branco usa DDG)",
    style: "width: 100%; font-family: var(--font-mono);",
    onchange: (e) => {
      adv.search.braveApiKey = e.target.value.trim();
      onChange();
    },
  });
  searchCard.appendChild(keyInput);
  searchDetails.appendChild(searchCard);
  searchSec.appendChild(searchDetails);
  elements.settingsBody.appendChild(searchSec);

  const slashSec = section("Slash commands");

  const slashDetails = document.createElement("details");
  slashDetails.className = "advanced-settings-details";
  const slashSummary = document.createElement("summary");
  slashSummary.textContent = "Gerenciar atalhos de barra (Slash Commands)";
  slashDetails.appendChild(slashSummary);

  const slashBody = document.createElement("div");
  slashBody.style.marginTop = "var(--s-2)";

  const slashHelp = document.createElement("p");
  slashHelp.className = "field-help";
  slashHelp.textContent = "Digite o trigger no início da mensagem (ou após uma quebra de linha) para abrir o autocompletar.";
  slashBody.appendChild(slashHelp);

  for (const sc of adv.slashCommands) {
    const row = document.createElement("div");
    row.className = "drawer-card";
    row.style.marginBottom = "var(--s-2)";
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
    slashBody.appendChild(row);
  }

  const addSlashBtn = button("+ Novo slash command", "btn-secondary", () => {
    adv.slashCommands.push({ trigger: "/novo", expansion: "" });
    onChange();
    rebuildPanel("advanced");
  });
  addSlashBtn.style.marginTop = "var(--s-2)";
  slashBody.appendChild(addSlashBtn);

  slashDetails.appendChild(slashBody);
  slashSec.appendChild(slashDetails);
  elements.settingsBody.appendChild(slashSec);

  const libSec = section("Prompt library");

  const libDetails = document.createElement("details");
  libDetails.className = "advanced-settings-details";
  const libSummary = document.createElement("summary");
  libSummary.textContent = "Gerenciar biblioteca de prompts salvos";
  libDetails.appendChild(libSummary);

  const libBody = document.createElement("div");
  libBody.style.marginTop = "var(--s-2)";

  // Search input
  const searchRow = document.createElement("div");
  searchRow.className = "row";
  searchRow.style.marginBottom = "var(--s-3)";
  const searchInput = input({ type: "text", placeholder: "Buscar prompts por nome, ID ou corpo...", style: "flex: 1;" });
  searchRow.appendChild(searchInput);
  libBody.appendChild(searchRow);

  const listContainer = document.createElement("div");
  libBody.appendChild(listContainer);

  function renderPromptList() {
    listContainer.replaceChildren();
    const q = searchInput.value.trim().toLowerCase();
    
    let prompts = adv.promptLibrary;
    if (q) {
      prompts = prompts.filter(p => 
        (p.name || "").toLowerCase().includes(q) ||
        (p.id || "").toLowerCase().includes(q) ||
        (p.body || "").toLowerCase().includes(q)
      );
    }
    
    if (prompts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = q ? "Nenhum prompt encontrado" : "Nenhum prompt salvo.";
      listContainer.appendChild(empty);
    }

    for (const p of prompts) {
      const row = document.createElement("div");
      row.className = "drawer-card";
      row.style.marginBottom = "var(--s-3)";

      const head = document.createElement("div");
      head.className = "row";
      
      const idInput = input({ type: "text", value: p.id, placeholder: "id", style: "width: 100px; font-family: var(--font-mono);" });
      idInput.addEventListener("change", (e) => {
        const newId = e.target.value.trim();
        if (adv.promptLibrary.some(x => x !== p && x.id === newId)) {
          toast("ID já em uso", "error");
          e.target.value = p.id;
        } else {
          p.id = newId;
          onChange();
        }
      });
      head.appendChild(idInput);

      const nameInput = input({ type: "text", value: p.name, placeholder: "Nome", style: "flex: 1;" });
      nameInput.addEventListener("change", (e) => {
        const val = e.target.value.trim();
        if (!val) {
          toast("Nome obrigatório", "error");
          e.target.value = p.name;
        } else {
          p.name = val;
          onChange();
        }
      });
      head.appendChild(nameInput);

      head.appendChild(button("Duplicar", "btn-ghost", () => {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = `${p.id}-copy-${Date.now()}`;
        copy.name = `${p.name} (cópia)`;
        adv.promptLibrary.push(copy);
        onChange();
        renderPromptList();
      }));

      head.appendChild(button("×", "btn-danger", () => {
        adv.promptLibrary = adv.promptLibrary.filter((x) => x !== p);
        onChange();
        renderPromptList();
      }));
      row.appendChild(head);

      // Tags
      const tagsRow = document.createElement("div");
      tagsRow.className = "row";
      tagsRow.style.alignItems = "center";
      tagsRow.style.flexWrap = "wrap";
      
      if (!p.tags) p.tags = [];
      p.tags.forEach(t => {
        const tagEl = document.createElement("span");
        tagEl.className = "rag-pill";
        tagEl.style.fontSize = "var(--fs-xs)";
        tagEl.textContent = t + " ×";
        tagEl.style.cursor = "pointer";
        tagEl.title = "Remover tag";
        tagEl.addEventListener("click", () => {
          p.tags = p.tags.filter(x => x !== t);
          onChange();
          renderPromptList();
        });
        tagsRow.appendChild(tagEl);
      });
      
      const tagInput = input({ type: "text", placeholder: "+ tag", style: "width: 80px; padding: 2px 6px; font-size: var(--fs-xs);" });
      tagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const val = tagInput.value.toLowerCase().replace(/\s+/g, "").trim();
          if (val.length >= 2 && !p.tags.includes(val)) {
            p.tags.push(val);
            onChange();
            renderPromptList();
          }
          tagInput.value = "";
        }
      });
      tagsRow.appendChild(tagInput);
      row.appendChild(tagsRow);

      const body = document.createElement("textarea");
      body.rows = 3;
      body.value = p.body;
      
      const preview = document.createElement("div");
      preview.className = "msg-reasoning-text";
      preview.style.background = "var(--bg-1)";
      preview.style.border = "1px solid var(--line)";
      preview.style.borderRadius = "var(--r-md)";
      preview.style.marginTop = "var(--s-2)";
      preview.style.maxHeight = "100px";
      preview.style.overflowY = "auto";
      
      const updatePreview = () => {
        preview.textContent = body.value || "O corpo do prompt aparecerá aqui…";
        if (!body.value) preview.style.color = "var(--fg-2)";
        else preview.style.color = "var(--fg-1)";
      };
      updatePreview();

      body.addEventListener("input", () => {
        updatePreview();
      });

      body.addEventListener("change", () => {
        const val = body.value.trim();
        if (!val) {
          toast("Corpo obrigatório", "error");
          body.value = p.body;
          updatePreview();
        } else {
          p.body = val;
          onChange();
        }
      });
      
      row.appendChild(body);
      row.appendChild(preview);

      listContainer.appendChild(row);
    }
  }

  searchInput.addEventListener("input", renderPromptList);
  renderPromptList();

  const addPromptBtn = button("+ Novo prompt", "btn-secondary", () => {
    adv.promptLibrary.push({ id: `p-${Date.now()}`, name: "Novo Prompt", body: "Digite seu prompt aqui...", tags: [] });
    onChange();
    renderPromptList();
  });
  addPromptBtn.style.marginTop = "var(--s-2)";
  libBody.appendChild(addPromptBtn);

  libDetails.appendChild(libBody);
  libSec.appendChild(libDetails);
  elements.settingsBody.appendChild(libSec);

  const ioSec = section("Backup");
  const ioDetails = document.createElement("details");
  ioDetails.className = "advanced-settings-details";
  const ioSummary = document.createElement("summary");
  ioSummary.textContent = "Exportar ou importar configuracoes";
  ioDetails.appendChild(ioSummary);
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
  ioDetails.appendChild(ioCard);
  ioSec.appendChild(ioDetails);
  elements.settingsBody.appendChild(ioSec);

  // Templates de conversa
  const tplSec = section("Templates de conversa");

  const tplDetails = document.createElement("details");
  tplDetails.className = "advanced-settings-details";
  const tplSummary = document.createElement("summary");
  tplSummary.textContent = "Gerenciar templates de contexto de conversa";
  tplDetails.appendChild(tplSummary);

  const tplBody = document.createElement("div");
  tplBody.style.marginTop = "var(--s-2)";

  const tplHelp = document.createElement("p");
  tplHelp.className = "field-help";
  tplHelp.textContent = "Salve conversas como templates para reutilizar contextos frequentes. Use o menu ⋮ de uma conversa no histórico para salvar.";
  tplBody.appendChild(tplHelp);

  function renderTemplateList() {
    const existing = tplBody.querySelector(".tpl-list");
    if (existing) existing.remove();
    const list = document.createElement("div");
    list.className = "tpl-list";
    list.style.marginTop = "var(--s-2)";
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
        row.style.marginBottom = "var(--s-2)";
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
    tplBody.appendChild(list);
  }

  renderTemplateList();
  tplDetails.appendChild(tplBody);
  tplSec.appendChild(tplDetails);
  elements.settingsBody.appendChild(tplSec);
}
