/* Tools Settings Panel */

import { toast } from "../toasts.js";
import { validateToolName, validateParametersSchema, getBuiltInTools } from "../../tools/manager.js";

/**
 * Renderiza o painel de ferramentas.
 */
export function panelTools({ store, onChange }) {
  const container = document.createElement("div");
  container.className = "settings-panel";

  const intro = document.createElement("p");
  intro.className = "field-help";
  intro.style.marginBottom = "var(--s-4)";
  intro.textContent = "Controle quais ferramentas o perfil ativo pode chamar.";
  container.appendChild(intro);

  // 1. Configurações Globais
  const globalSection = document.createElement("div");
  globalSection.className = "settings-section";
  globalSection.innerHTML = '<h3 class="settings-section-title">Comportamento</h3>';
  
  const confirmRow = document.createElement("label");
  confirmRow.className = "checkbox-row";
  const confirmCheck = document.createElement("input");
  confirmCheck.type = "checkbox";
  confirmCheck.checked = store.get("advanced")?.tools?.requireConfirmation || false;
  confirmCheck.addEventListener("change", (e) => {
    const adv = store.get("advanced");
    if (!adv.tools) adv.tools = {};
    adv.tools.requireConfirmation = e.target.checked;
    store.set("advanced", adv);
    onChange();
  });
  confirmRow.appendChild(confirmCheck);
  confirmRow.appendChild(document.createTextNode("Confirmar antes de executar cada ferramenta"));
  globalSection.appendChild(confirmRow);
  container.appendChild(globalSection);

  // 2. Ferramentas do Perfil Ativo
  const profileSection = document.createElement("div");
  profileSection.className = "settings-section";
  profileSection.innerHTML = '<h3 class="settings-section-title">Ferramentas no Perfil Atual</h3>';
  
  const activeProfileId = store.get("activeProfileId");
  const profiles = store.get("profiles");
  const profile = profiles.find(p => p.id === activeProfileId);
  
  if (profile) {
    const help = document.createElement("p");
    help.className = "field-help";
    help.style.marginBottom = "var(--s-3)";
    help.textContent = `Selecione quais ferramentas o perfil "${profile.name}" pode usar:`;
    profileSection.appendChild(help);

    const tools = store.get("tools") || [];
    const list = document.createElement("div");
    list.className = "tools-list grid";
    list.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
    list.style.gap = "var(--s-2)";

    tools.forEach(tool => {
      const card = document.createElement("div");
      card.className = "card tool-card";
      card.style.padding = "var(--s-2) var(--s-3)";
      
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = (profile.tools || []).includes(tool.id);
      check.addEventListener("change", (e) => {
        if (e.target.checked) {
          if (!profile.tools) profile.tools = [];
          if (!profile.tools.includes(tool.id)) profile.tools.push(tool.id);
        } else {
          profile.tools = (profile.tools || []).filter(id => id !== tool.id);
        }
        store.set("profiles", profiles);
        onChange();
      });

      const info = document.createElement("div");
      info.className = "col";
      info.style.gap = "2px";
      info.style.flex = "1";
      const name = document.createElement("div");
      name.className = "text-sm weight-600";
      name.textContent = tool.name;
      const desc = document.createElement("div");
      desc.className = "text-xs fg-2 line-clamp-1";
      desc.textContent = tool.description;
      
      info.appendChild(name);
      info.appendChild(desc);

      const top = document.createElement("label");
      top.className = "row";
      top.style.cursor = "pointer";
      top.style.width = "100%";
      top.appendChild(check);
      top.appendChild(info);
      
      const details = document.createElement("details");
      details.className = "tool-details";
      const summary = document.createElement("summary");
      summary.textContent = "Detalhes";
      const full = document.createElement("p");
      full.textContent = tool.description || "Sem descricao.";
      details.appendChild(summary);
      details.appendChild(full);

      card.appendChild(top);
      card.appendChild(details);
      list.appendChild(card);
    });

    profileSection.appendChild(list);
  } else {
    profileSection.innerHTML += '<p class="fg-danger">Nenhum perfil selecionado.</p>';
  }
  container.appendChild(profileSection);

  // 3. Ferramentas Customizadas
  const customSection = document.createElement("div");
  customSection.className = "settings-section";
  customSection.innerHTML = '<h3 class="settings-section-title">Minhas Ferramentas</h3>';
  
  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-secondary btn-sm";
  addBtn.style.marginBottom = "var(--s-3)";
  addBtn.textContent = "+ Criar ferramenta";
  addBtn.addEventListener("click", () => openToolEditor(null, { store, onChange, container }));
  customSection.appendChild(addBtn);

  const customList = document.createElement("div");
  customList.className = "col";
  customList.style.gap = "var(--s-2)";
  
  const allTools = store.get("tools") || [];
  const customTools = allTools.filter(t => !t.builtIn);
  
  if (customTools.length === 0) {
    const empty = document.createElement("p");
    empty.className = "field-help italic";
    empty.textContent = "Nenhuma ferramenta customizada criada.";
    customList.appendChild(empty);
  } else {
    customTools.forEach(t => {
      const row = document.createElement("div");
      row.className = "card row items-center justify-between";
      row.style.padding = "var(--s-2) var(--s-3)";
      
      const info = document.createElement("div");
      info.className = "col";
      info.style.flex = "1";
      const title = document.createElement("div");
      title.className = "text-sm weight-600";
      title.textContent = t.name;
      const desc = document.createElement("div");
      desc.className = "text-xs fg-2 line-clamp-1";
      desc.textContent = t.description;
      const details = document.createElement("details");
      details.className = "tool-details";
      const detailsSummary = document.createElement("summary");
      detailsSummary.textContent = "Detalhes";
      const full = document.createElement("p");
      full.textContent = t.description || "Sem descricao.";
      details.appendChild(detailsSummary);
      details.appendChild(full);
      info.appendChild(title);
      info.appendChild(desc);
      info.appendChild(details);
      
      const actions = document.createElement("div");
      actions.className = "row";
      actions.style.gap = "var(--s-1)";
      
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost btn-sm";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", () => openToolEditor(t, { store, onChange, container }));
      
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.textContent = "Excluir";
      delBtn.addEventListener("click", () => {
        if (confirm(`Excluir ferramenta "${t.name}"?`)) {
          const updated = allTools.filter(item => item.id !== t.id);
          store.set("tools", updated);
          // Remove de todos os perfis
          const allProfiles = store.get("profiles");
          allProfiles.forEach(p => {
            p.tools = (p.tools || []).filter(id => id !== t.id);
          });
          store.set("profiles", allProfiles);
          onChange();
          renderCustomList(customList, { store, onChange, container });
        }
      });
      
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(actions);
      customList.appendChild(row);
    });
  }
  
  customSection.appendChild(customList);
  container.appendChild(customSection);

  return container;
}

function renderCustomList(listNode, { store, onChange, container }) {
  const tools = store.get("tools") || [];
  const custom = tools.filter(t => !t.builtIn);
  listNode.replaceChildren();
  
  if (custom.length === 0) {
    const empty = document.createElement("p");
    empty.className = "field-help italic";
    empty.textContent = "Nenhuma ferramenta customizada criada.";
    listNode.appendChild(empty);
    return;
  }

  custom.forEach(t => {
    const row = document.createElement("div");
    row.className = "card row items-center justify-between";
    row.style.padding = "var(--s-2) var(--s-3)";
    
    const info = document.createElement("div");
    info.className = "col";
    info.style.flex = "1";
    const title = document.createElement("div");
    title.className = "text-sm weight-600";
    title.textContent = t.name;
    const desc = document.createElement("div");
    desc.className = "text-xs fg-2 line-clamp-1";
    desc.textContent = t.description;
    const details = document.createElement("details");
    details.className = "tool-details";
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "Detalhes";
    const full = document.createElement("p");
    full.textContent = t.description || "Sem descricao.";
    details.appendChild(detailsSummary);
    details.appendChild(full);
    info.appendChild(title);
    info.appendChild(desc);
    info.appendChild(details);
    
    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.gap = "var(--s-1)";
    
    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-ghost btn-sm";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => openToolEditor(t, { store, onChange, container }));
    
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.textContent = "Excluir";
    delBtn.addEventListener("click", () => {
      if (confirm(`Excluir ferramenta "${t.name}"?`)) {
        const updated = (store.get("tools") || []).filter(item => item.id !== t.id);
        store.set("tools", updated);
        const allProfiles = store.get("profiles");
        allProfiles.forEach(p => { p.tools = (p.tools || []).filter(id => id !== t.id); });
        store.set("profiles", allProfiles);
        onChange();
        renderCustomList(listNode, { store, onChange, container });
      }
    });
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    row.appendChild(info);
    row.appendChild(actions);
    listNode.appendChild(row);
  });
}

function openToolEditor(tool, { store, onChange, container }) {
  const isNew = !tool;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.zIndex = "100";

  const modal = document.createElement("div");
  modal.className = "modal col";
  modal.style.maxWidth = "600px";
  modal.style.width = "90vw";
  modal.style.maxHeight = "90vh";
  modal.style.overflow = "auto";
  modal.style.padding = "var(--s-4)";

  modal.innerHTML = `<h3>${isNew ? "Nova Ferramenta" : "Editar Ferramenta"}</h3>`;
  
  const form = document.createElement("div");
  form.className = "col";
  form.style.gap = "var(--s-3)";
  form.style.marginTop = "var(--s-3)";

  const field = (label, desc, el) => {
    const f = document.createElement("div");
    f.className = "field";
    f.innerHTML = `<label class="field-label">${label}</label><p class="field-help">${desc}</p>`;
    f.appendChild(el);
    return f;
  };

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "ex: calcular_frete";
  nameInput.value = tool?.name || "";
  form.appendChild(field("Nome", "Identificador único (letras minúsculas, números e _)", nameInput));

  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.placeholder = "Descrição para o modelo...";
  descInput.value = tool?.description || "";
  form.appendChild(field("Descrição", "Explique ao modelo quando e como usar esta ferramenta", descInput));

  const paramsText = document.createElement("textarea");
  paramsText.rows = 8;
  paramsText.style.fontFamily = "var(--font-mono)";
  paramsText.style.fontSize = "var(--fs-xs)";
  paramsText.value = tool ? JSON.stringify(tool.parameters, null, 2) : '{\n  "type": "object",\n  "properties": {\n    "param1": { "type": "string", "description": "Descrição" }\n  },\n  "required": ["param1"]\n}';
  form.appendChild(field("Parâmetros (JSON Schema)", "Definição dos argumentos esperados", paramsText));

  const implText = document.createElement("textarea");
  implText.rows = 10;
  implText.style.fontFamily = "var(--font-mono)";
  implText.style.fontSize = "var(--fs-xs)";
  implText.value = tool?.implementation || '// args contém os parâmetros parseados\n// return o resultado (string, objeto ou Promise)\nreturn `Olá, ${args.param1}!`;';
  form.appendChild(field("Implementação JavaScript", "Código que será executado", implText));

  const actions = document.createElement("div");
  actions.className = "row justify-end";
  actions.style.gap = "var(--s-2)";
  actions.style.marginTop = "var(--s-2)";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-ghost";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => overlay.remove());

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Salvar";
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!validateToolName(name)) {
      toast("Nome inválido. Use apenas letras minúsculas, números e _ (máx 64 chars).", "error");
      return;
    }

    let params;
    try {
      params = JSON.parse(paramsText.value);
      const val = validateParametersSchema(params);
      if (!val.ok) {
        toast(val.error, "error");
        return;
      }
    } catch (err) {
      toast("JSON Schema inválido: " + err.message, "error");
      return;
    }

    const allTools = store.get("tools") || [];
    if (isNew && allTools.find(t => t.name === name)) {
      toast(`Já existe uma ferramenta com o nome "${name}".`, "error");
      return;
    }

    const newTool = {
      id: tool?.id || crypto.randomUUID(),
      name,
      description: descInput.value.trim(),
      parameters: params,
      implementation: implText.value.trim(),
      enabled: true,
      builtIn: false,
    };

    if (isNew) {
      allTools.push(newTool);
    } else {
      const idx = allTools.findIndex(t => t.id === tool.id);
      allTools[idx] = newTool;
    }

    store.set("tools", allTools);
    onChange();
    overlay.remove();
    // Re-render the panel (simplificado: recarrega a lista customizada)
    const customList = container.querySelector(".settings-section:last-child .col");
    if (customList) renderCustomList(customList, { store, onChange, container });
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  modal.appendChild(form);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
