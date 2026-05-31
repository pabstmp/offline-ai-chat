import { defaultSampling } from "../../schema.js";
import { isLikelyThinkingModel } from "../../model-catalog.js";
import { toast } from "../toasts.js";
import { state, populateModelSelectWithOptions, section, field, input, select, button, downloadJson } from "./_shared.js";

export function panelProfiles() {
  const { store, elements, onChange, onProfileChange, rebuildPanel } = state;
  const profiles = store.get("profiles");
  const activeId = store.get("activeProfileId");
  const sec = section("Perfis");

  for (const p of profiles) {
    const isActive = activeId === p.id;
    const c = document.createElement("details");
    c.className = "advanced-settings-details profile-details" + (isActive ? " active-card" : "");
    c.open = isActive;

    const summary = document.createElement("summary");
    summary.className = "profile-summary";
    const avatar = document.createElement("span");
    avatar.className = "profile-summary-icon";
    avatar.textContent = p.icon || "🤖";
    const summaryText = document.createElement("span");
    summaryText.className = "profile-summary-text";
    const title = document.createElement("strong");
    title.textContent = p.name || "(sem nome)";
    const meta = document.createElement("span");
    meta.textContent = p.defaultModel || "Sem modelo";
    summaryText.appendChild(title);
    summaryText.appendChild(meta);
    summary.appendChild(avatar);
    summary.appendChild(summaryText);
    if (isActive) {
      const badge = document.createElement("span");
      badge.className = "profile-summary-badge";
      badge.textContent = "Ativo";
      summary.appendChild(badge);
    }
    c.appendChild(summary);

    c.addEventListener("toggle", () => {
      if (!c.open) return;
      sec.querySelectorAll("details.profile-details[open]").forEach((other) => {
        if (other !== c) other.open = false;
      });
    });

    const body = document.createElement("div");
    body.className = "profile-editor";

    const head = document.createElement("div");
    head.className = "row";
    const icon = input({ type: "text", value: p.icon || "", placeholder: "🤖", maxLength: 4,
      style: "width: 60px; text-align: center; font-size: 1.4rem;",
      onchange: (e) => { p.icon = e.target.value; onChange(); refreshProfileChip(); rebuildPanel("profiles"); },
    });
    const name = input({ type: "text", value: p.name, style: "flex: 1; font-weight: 600;",
      onchange: (e) => { p.name = e.target.value; onChange(); refreshProfileChip(); rebuildPanel("profiles"); },
    });
    head.appendChild(icon);
    head.appendChild(name);
    body.appendChild(head);

    body.appendChild(field("System prompt", (() => {
      const ta = document.createElement("textarea");
      ta.rows = 4;
      ta.value = p.systemPrompt;
      ta.addEventListener("change", () => { p.systemPrompt = ta.value; onChange(); });
      return ta;
    })()));

    body.appendChild(buildModelSelector(p));

    if (p.defaultModel && isLikelyThinkingModel(p.defaultModel)) {
      const banner = document.createElement("div");
      banner.style.padding = "var(--s-2) var(--s-3)";
      banner.style.background = "var(--accent-soft)";
      banner.style.border = "1px solid var(--accent)";
      banner.style.borderRadius = "var(--r-sm)";
      banner.style.marginTop = "var(--s-2)";
      banner.style.fontSize = "var(--fs-xs)";
      banner.innerHTML = `<strong>💭 Modelo de raciocínio detectado.</strong> Ele gasta tokens em chain-of-thought que <strong>contam dentro de <code>max_tokens</code></strong> — mantenha em 4000+.`;
      body.appendChild(banner);
    }

    body.appendChild(buildSamplingDetails(p));

    const actions = document.createElement("div");
    actions.className = "row";
    actions.appendChild(button(isActive ? "✓ Ativo" : "Ativar", isActive ? "btn-primary" : "btn-secondary", () => {
      store.set("activeProfileId", p.id);
      onProfileChange();
      rebuildPanel("profiles");
    }));
    actions.appendChild(button("Duplicar", "btn-ghost", () => {
      const copy = { ...p, id: `profile-${Date.now()}`, name: `${p.name} (cópia)`, sampling: { ...p.sampling } };
      store.set("profiles", [...profiles, copy]);
      onChange();
      rebuildPanel("profiles");
    }));
    actions.appendChild(button("Exportar", "btn-ghost", () => downloadJson(`profile-${p.id}.json`, p)));
    if (profiles.length > 1) {
      actions.appendChild(button("Excluir", "btn-danger", () => {
        if (!confirm(`Excluir perfil "${p.name}"?`)) return;
        const filtered = profiles.filter((x) => x.id !== p.id);
        store.set("profiles", filtered);
        if (isActive) store.set("activeProfileId", filtered[0].id);
        onProfileChange();
        rebuildPanel("profiles");
      }));
    }
    body.appendChild(actions);
    c.appendChild(body);
    sec.appendChild(c);
  }

  const addRow = document.createElement("div");
  addRow.className = "row";
  addRow.appendChild(button("+ Novo perfil", "btn-secondary", () => {
    const id = `profile-${Date.now()}`;
    store.set("profiles", [...profiles, {
      id, name: "Novo perfil", icon: "✨",
      systemPrompt: "Você é um assistente útil.",
      defaultModel: "",
      sampling: defaultSampling(),
    }]);
    onChange();
    rebuildPanel("profiles");
  }));
  addRow.appendChild(button("Importar JSON", "btn-ghost", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.addEventListener("change", async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const obj = JSON.parse(await file.text());
        if (!obj.id || !obj.name || !obj.systemPrompt) throw new Error("JSON inválido");
        obj.id = `${obj.id}-${Date.now()}`;
        store.set("profiles", [...profiles, obj]);
        onChange();
        rebuildPanel("profiles");
        toast("Perfil importado.", "success");
      } catch (err) { toast("Erro: " + err.message, "error"); }
    });
    inp.click();
  }));
  sec.appendChild(addRow);
  elements.settingsBody.appendChild(sec);
}

function buildModelSelector(profile) {
  const { elements, onChange, onConnect } = state;
  return field("Modelo padrão deste perfil", (() => {
    const row = document.createElement("div");
    row.className = "row";
    const sel = document.createElement("select");
    sel.style.flex = "1";
    const hasModels = elements.modelOptions?.length;
    populateModelSelectWithOptions(sel, elements.modelOptions || [], profile.defaultModel || "");

    const modelIds = (elements.modelOptions || []).map(m => typeof m === "string" ? m : m.id);
    if (profile.defaultModel && (!hasModels || !modelIds.includes(profile.defaultModel))) {
      const opt = new Option(profile.defaultModel, profile.defaultModel);
      opt.selected = true;
      sel.appendChild(opt);
    } else {
      sel.value = profile.defaultModel || "";
    }
    sel.addEventListener("change", () => {
      profile.defaultModel = sel.value;
      onChange();
      state.rebuildPanel("profiles");
    });
    const reload = button("↻", "btn-ghost", () => onConnect());
    reload.title = "Recarregar lista do servidor";
    row.appendChild(sel);
    row.appendChild(reload);
    return row;
  })());
}

function buildSamplingDetails(profile) {
  const { onChange } = state;
  const det = document.createElement("details");
  det.style.marginTop = "var(--s-2)";
  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.style.color = "var(--fg-2)";
  summary.style.fontSize = "var(--fs-sm)";
  summary.style.fontWeight = "600";
  summary.style.userSelect = "none";
  summary.textContent = "Parâmetros de inferência";
  det.appendChild(summary);

  const help = document.createElement("p");
  help.className = "field-help";
  help.textContent = "Cada parâmetro é opcional. Ative o checkbox para incluir no payload — desativado significa que o servidor usa seu default.";
  det.appendChild(help);

  const params = [
    { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.05, default: 0.7 },
    { key: "top_p", label: "top_p", min: 0, max: 1, step: 0.01, default: 0.95 },
    { key: "top_k", label: "top_k", min: 0, max: 200, step: 1, default: 40 },
    { key: "min_p", label: "min_p", min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: "repeat_penalty", label: "repeat_penalty", min: 0.5, max: 2, step: 0.01, default: 1.1 },
    { key: "presence_penalty", label: "presence_penalty", min: -2, max: 2, step: 0.05, default: 0 },
    { key: "frequency_penalty", label: "frequency_penalty", min: -2, max: 2, step: 0.05, default: 0 },
    { key: "max_tokens", label: "max_tokens", min: 1, max: 32000, step: 1, default: 1024 },
    { key: "seed", label: "seed", min: 0, max: 999999, step: 1, default: 42 },
    { key: "n", label: "n", min: 1, max: 4, step: 1, default: 1 },
  ];

  const paramsCard = document.createElement("div");
  paramsCard.className = "drawer-card";
  paramsCard.style.marginTop = "var(--s-2)";

  for (const p of params) {
    const row = document.createElement("div");
    row.className = "param-row";
    const isOn = profile.sampling[p.key] !== null && profile.sampling[p.key] !== undefined;
    if (!isOn) row.classList.add("disabled");

    const cb = input({ type: "checkbox", checked: isOn });
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = p.label;
    const range = input({
      type: "range", min: p.min, max: p.max, step: p.step,
      value: profile.sampling[p.key] != null ? profile.sampling[p.key] : p.default,
    });
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = range.value;

    range.addEventListener("input", () => {
      profile.sampling[p.key] = Number(range.value);
      value.textContent = range.value;
      cb.checked = true;
      row.classList.remove("disabled");
      onChange();
    });

    cb.addEventListener("change", () => {
      profile.sampling[p.key] = cb.checked ? Number(range.value) : null;
      row.classList.toggle("disabled", !cb.checked);
      onChange();
    });

    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(range);
    row.appendChild(value);
    paramsCard.appendChild(row);
  }
  det.appendChild(paramsCard);

  const stopWrap = document.createElement("div");
  stopWrap.style.marginTop = "var(--s-2)";
  stopWrap.appendChild(field("Stop sequences (uma por linha)", (() => {
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.placeholder = "</s>\n\\n\\nUser:";
    ta.value = (profile.sampling.stop || []).join("\n");
    ta.addEventListener("change", () => {
      profile.sampling.stop = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
      onChange();
    });
    return ta;
  })()));
  stopWrap.appendChild(field("response_format", (() => {
    const s = select(
      [{ value: "text", label: "Texto livre" }, { value: "json_object", label: "JSON object" }],
      profile.sampling.response_format || "text"
    );
    s.addEventListener("change", () => { profile.sampling.response_format = s.value; onChange(); });
    return s;
  })()));
  det.appendChild(stopWrap);

  det.appendChild(button("Resetar parâmetros para padrão", "btn-ghost", () => {
    Object.assign(profile.sampling, defaultSampling());
    onChange();
    state.rebuildPanel("profiles");
  }));

  return det;
}

export function refreshProfileChip() {
  const labelEl = document.querySelector("#profileChipLabel");
  if (!labelEl) return;
  const profiles = state.store.get("profiles") || [];
  const id = state.store.get("activeProfileId");
  const p = profiles.find((x) => x.id === id);
  if (p) labelEl.textContent = `${p.icon || ""} ${p.name}`.trim();
}
