/* "Hardware" tab — detection + curated model recommendations.
   Sampling moved to the Profiles tab (sampling is per-profile anyway). */

import { detectHardware, describeHardware } from "../../hardware.js";
import { recommendFor, CATEGORIES } from "../../model-catalog.js";
import { toast } from "../toasts.js";
import { state, section, field, input, checkbox, button, getActiveProfile } from "./_shared.js";

export function panelModel() {
  const { elements } = state;
  buildHardwareCard().then((hwCard) => {
    elements.settingsBody.appendChild(hwCard);
  });
}

async function buildHardwareCard() {
  const { store, onChange, rebuildPanel } = state;
  const hwCard = document.createElement("section");
  hwCard.className = "drawer-section";

  const title = document.createElement("h3");
  title.className = "drawer-section-title";
  title.textContent = "Sua máquina";
  hwCard.appendChild(title);

  const inner = document.createElement("div");
  inner.className = "drawer-card";

  const override = store.get("hardwareOverride");
  let spec;
  if (override) {
    spec = { ...override, _isOverride: true };
  } else {
    spec = await detectHardware();
  }
  if (!spec.estimatedVramGB && override?.estimatedVramGB) {
    spec.estimatedVramGB = override.estimatedVramGB;
  }

  const desc = document.createElement("p");
  desc.style.margin = "0";
  desc.style.fontSize = "var(--fs-sm)";
  desc.textContent = describeHardware(spec) || "Hardware não detectado";
  inner.appendChild(desc);

  if (spec.deviceMemoryCapped) {
    const note = document.createElement("p");
    note.className = "field-help";
    note.textContent = "⚠ Browser cap em 8GB pra RAM (privacidade). Use override manual pra valor exato.";
    inner.appendChild(note);
  }
  if (spec.gpu?.masked) {
    const note = document.createElement("p");
    note.className = "field-help";
    note.textContent = "⚠ Browser está mascarando o nome da GPU. Use override manual.";
    inner.appendChild(note);
  }
  if (spec._isOverride) {
    const note = document.createElement("p");
    note.className = "field-help";
    note.style.color = "var(--accent)";
    note.textContent = "✓ Usando override manual. Clique em \"Editar\" pra ajustar.";
    inner.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.className = "row";
  actions.appendChild(button("Editar manualmente", "btn-ghost", () => openHardwareOverrideDialog(spec)));
  if (spec._isOverride) {
    actions.appendChild(button("Resetar pra detecção automática", "btn-ghost", () => {
      store.set("hardwareOverride", null);
      onChange();
      rebuildPanel("model");
    }));
  }
  inner.appendChild(actions);
  hwCard.appendChild(inner);

  const recTitle = document.createElement("h3");
  recTitle.className = "drawer-section-title";
  recTitle.style.marginTop = "var(--s-4)";
  recTitle.textContent = "Recomendados pra sua máquina";
  hwCard.appendChild(recTitle);

  const catRow = document.createElement("div");
  catRow.className = "row";
  catRow.style.gap = "var(--s-1)";
  const catState = { current: "general" };

  const recList = document.createElement("div");
  recList.style.display = "flex";
  recList.style.flexDirection = "column";
  recList.style.gap = "var(--s-2)";

  function renderCategory(catId) {
    catState.current = catId;
    [...catRow.children].forEach((b) => b.classList.toggle("btn-primary", b.dataset.cat === catId));
    [...catRow.children].forEach((b) => b.classList.toggle("btn-ghost", b.dataset.cat !== catId));
    recList.replaceChildren();
    const recs = recommendFor(spec, { category: catId, limit: 5 });
    if (!recs.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "Nenhum modelo recomendado pra este hardware nesta categoria. Ajuste o override manual ou veja outra categoria.";
      recList.appendChild(empty);
      return;
    }
    recs.slice(0, 3).forEach((m, idx) => {
      recList.appendChild(buildRecommendationRow(m, idx));
    });
    if (recs.length > 3) {
      const more = document.createElement("details");
      more.className = "advanced-settings-details compact-details";
      const summary = document.createElement("summary");
      summary.textContent = `Mostrar mais ${recs.length - 3} recomendacoes`;
      more.appendChild(summary);
      recs.slice(3).forEach((m, idx) => {
        more.appendChild(buildRecommendationRow(m, idx + 3));
      });
      recList.appendChild(more);
    }
  }

  for (const cat of CATEGORIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-sm ${cat.id === catState.current ? "btn-primary" : "btn-ghost"}`;
    btn.dataset.cat = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener("click", () => renderCategory(cat.id));
    catRow.appendChild(btn);
  }
  hwCard.appendChild(catRow);
  hwCard.appendChild(recList);
  renderCategory("general");

  return hwCard;
}

function buildRecommendationRow(m, idx) {
  const { onChange, onProfileChange } = state;
  const row = document.createElement("div");
  row.className = "drawer-card";
  row.style.padding = "var(--s-3)";

  const head = document.createElement("div");
  head.className = "row";
  head.style.gap = "var(--s-2)";

  const num = document.createElement("span");
  num.style.fontWeight = "700";
  num.style.color = "var(--accent)";
  num.style.fontSize = "var(--fs-sm)";
  num.textContent = `#${idx + 1}`;

  const name = document.createElement("strong");
  name.style.flex = "1";
  name.textContent = m.name;

  const fitTag = document.createElement("span");
  fitTag.style.fontSize = "var(--fs-xs)";
  fitTag.style.padding = "2px 8px";
  fitTag.style.borderRadius = "var(--r-sm)";
  if (m.fitScore === "fit") {
    fitTag.style.color = "var(--success)";
    fitTag.style.background = "rgba(74, 222, 128, 0.12)";
    fitTag.textContent = "✓ cabe";
  } else {
    fitTag.style.color = "var(--warn)";
    fitTag.style.background = "rgba(251, 191, 36, 0.12)";
    fitTag.textContent = "apertado";
  }

  head.appendChild(num);
  head.appendChild(name);
  head.appendChild(fitTag);
  row.appendChild(head);

  const tech = document.createElement("details");
  tech.className = "recommendation-details";
  const techSummary = document.createElement("summary");
  techSummary.textContent = "Detalhes";
  tech.appendChild(techSummary);

  const meta = document.createElement("p");
  meta.className = "field-help";
  meta.style.margin = "0";
  meta.textContent = `${m.params}B params · ${m.fileSizeGB}GB · ${formatContextWindow(m.contextWindow)} ctx · ~${m.recommendedVramGB}GB VRAM · ${m.strengths.join(", ")}`;
  tech.appendChild(meta);

  if (m.notes) {
    const notes = document.createElement("p");
    notes.className = "field-help";
    notes.style.margin = "var(--s-1) 0 0";
    notes.style.color = "var(--fg-1)";
    notes.textContent = m.notes;
    tech.appendChild(notes);
  }
  row.appendChild(tech);

  const actionsRow = document.createElement("div");
  actionsRow.className = "row";
  actionsRow.style.marginTop = "var(--s-2)";

  const useBtn = button("Usar neste perfil", "btn-secondary", () => {
    const p = getActiveProfile();
    p.defaultModel = m.id.includes("/") ? m.id : "";
    if (!p.defaultModel) {
      p.defaultModel = m.lmStudioSearch.replace(/\sgguf$/i, "").replace(/\s+/g, "-");
    }
    onChange();
    onProfileChange();
    toast(`Modelo do perfil "${p.name}" definido como "${p.defaultModel}". Confirme se bate com o ID exato no LM Studio.`, "info", 5000);
  });
  useBtn.classList.add("btn-sm");

  const lmLink = document.createElement("a");
  lmLink.href = `https://lmstudio.ai/models?q=${encodeURIComponent(m.lmStudioSearch)}`;
  lmLink.target = "_blank";
  lmLink.rel = "noopener noreferrer";
  lmLink.className = "btn btn-ghost btn-sm";
  lmLink.textContent = "🔗 Buscar no LM Studio";
  lmLink.style.textDecoration = "none";

  actionsRow.appendChild(useBtn);
  actionsRow.appendChild(lmLink);
  row.appendChild(actionsRow);

  return row;
}

function formatContextWindow(n) {
  if (!n) return "?";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function openHardwareOverrideDialog(currentSpec) {
  const { store, onChange, rebuildPanel } = state;
  const dialog = document.createElement("dialog");
  dialog.className = "palette";
  dialog.style.maxWidth = "480px";

  const header = document.createElement("div");
  header.style.padding = "var(--s-4)";
  header.style.borderBottom = "1px solid var(--line)";
  const title = document.createElement("h2");
  title.style.margin = "0";
  title.style.fontSize = "var(--fs-lg)";
  title.textContent = "Override manual de hardware";
  header.appendChild(title);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.style.padding = "var(--s-4)";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "var(--s-3)";

  const draft = {
    estimatedVramGB: currentSpec.estimatedVramGB || 8,
    deviceMemoryGB: currentSpec.deviceMemoryGB || 16,
    cpuCores: currentSpec.cpuCores || 8,
    isAppleSilicon: !!currentSpec.isAppleSilicon,
    gpu: { renderer: currentSpec.gpu?.renderer || "" },
  };

  body.appendChild(field("VRAM (GB)", input({
    type: "number", value: draft.estimatedVramGB, min: "1", max: "256", step: "1",
    onchange: (e) => { draft.estimatedVramGB = Number(e.target.value); },
  })));
  body.appendChild(field("RAM total (GB)", input({
    type: "number", value: draft.deviceMemoryGB, min: "1", max: "1024", step: "1",
    onchange: (e) => { draft.deviceMemoryGB = Number(e.target.value); },
  })));
  body.appendChild(field("CPU cores", input({
    type: "number", value: draft.cpuCores, min: "1", max: "256", step: "1",
    onchange: (e) => { draft.cpuCores = Number(e.target.value); },
  })));
  body.appendChild(checkbox("Apple Silicon (M1/M2/M3/M4 — RAM unificada)", draft.isAppleSilicon, (v) => {
    draft.isAppleSilicon = v;
  }));
  body.appendChild(field("Nome da GPU (opcional)", input({
    type: "text", value: draft.gpu.renderer, placeholder: "ex: RTX 4070",
    onchange: (e) => { draft.gpu.renderer = e.target.value.trim(); },
  })));

  dialog.appendChild(body);

  const footer = document.createElement("div");
  footer.style.padding = "var(--s-3) var(--s-4)";
  footer.style.borderTop = "1px solid var(--line)";
  footer.style.display = "flex";
  footer.style.gap = "var(--s-2)";
  footer.style.justifyContent = "flex-end";
  footer.appendChild(button("Cancelar", "btn-ghost", () => dialog.close()));
  footer.appendChild(button("Salvar", "btn-primary", () => {
    store.set("hardwareOverride", draft);
    onChange();
    dialog.close();
    rebuildPanel("model");
    toast("Override salvo.", "success");
  }));
  dialog.appendChild(footer);

  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
