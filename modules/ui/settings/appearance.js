import { applyAppearance } from "../../theme.js";
import { state, section, field, input, select, checkbox, card } from "./_shared.js";

export function panelAppearance() {
  const { store, elements, onChange, rebuildPanel } = state;
  const a = store.get("appearance");
  const sec = section("Tema");

  sec.appendChild(card([
    field("Tema", (() => {
      const s = select(
        [{ value: "system", label: "Seguir sistema" }, { value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }],
        a.theme
      );
      s.addEventListener("change", () => { a.theme = s.value; applyAppearance(a); onChange(); });
      return s;
    })()),
    (() => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const lbl = document.createElement("label");
      lbl.className = "field-label";
      lbl.textContent = "Cor de destaque";
      wrap.appendChild(lbl);

      const grid = document.createElement("div");
      grid.className = "color-grid";
      const presets = ["#7c5cff", "#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#ec4899", "#9333ea"];
      for (const c of presets) {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "color-swatch";
        sw.style.background = c;
        if (a.accentColor === c) sw.classList.add("active");
        sw.addEventListener("click", () => {
          a.accentColor = c;
          applyAppearance(a);
          onChange();
          rebuildPanel("appearance");
        });
        grid.appendChild(sw);
      }
      const custom = input({
        type: "color", value: a.accentColor,
        onchange: (e) => { a.accentColor = e.target.value; applyAppearance(a); onChange(); },
      });
      grid.appendChild(custom);
      wrap.appendChild(grid);
      return wrap;
    })(),
  ]));
  elements.settingsBody.appendChild(sec);

  const sec2 = section("Tipografia & densidade");
  sec2.appendChild(card([
    field("Densidade", (() => {
      const s = select(
        [{ value: "compact", label: "Compacta" }, { value: "normal", label: "Normal" }, { value: "spacious", label: "Espaçosa" }],
        a.density
      );
      s.addEventListener("change", () => { a.density = s.value; applyAppearance(a); onChange(); });
      return s;
    })()),
    field("Tamanho da fonte", (() => {
      const wrap = document.createElement("div");
      wrap.className = "row";
      const r = input({ type: "range", min: "13", max: "18", step: "1", value: String(a.fontSize) });
      const v = document.createElement("span");
      v.className = "value";
      v.style.minWidth = "40px";
      v.style.fontFamily = "var(--font-mono)";
      v.textContent = `${a.fontSize}px`;
      r.addEventListener("input", () => {
        a.fontSize = Number(r.value);
        v.textContent = `${a.fontSize}px`;
        applyAppearance(a);
        onChange();
      });
      wrap.appendChild(r);
      wrap.appendChild(v);
      return wrap;
    })()),
    field("Raio dos cantos", (() => {
      const wrap = document.createElement("div");
      wrap.className = "row";
      const r = input({ type: "range", min: "0", max: "20", step: "1", value: String(a.radius) });
      const v = document.createElement("span");
      v.className = "value";
      v.style.minWidth = "40px";
      v.style.fontFamily = "var(--font-mono)";
      v.textContent = `${a.radius}px`;
      r.addEventListener("input", () => {
        a.radius = Number(r.value);
        v.textContent = `${a.radius}px`;
        applyAppearance(a);
        onChange();
      });
      wrap.appendChild(r);
      wrap.appendChild(v);
      return wrap;
    })()),
    field("Fonte UI (opcional)", input({
      type: "text", value: a.fontUI === "system" ? "" : a.fontUI, placeholder: "vazio = sistema",
      onchange: (e) => { a.fontUI = e.target.value.trim() || "system"; applyAppearance(a); onChange(); },
    })),
    field("Fonte código (opcional)", input({
      type: "text", value: a.fontMono === "system" ? "" : a.fontMono, placeholder: "vazio = sistema",
      onchange: (e) => { a.fontMono = e.target.value.trim() || "system"; applyAppearance(a); onChange(); },
    })),
  ]));
  elements.settingsBody.appendChild(sec2);

  const sec3 = section("Modos");
  const card3 = document.createElement("div");
  card3.className = "drawer-card";
  card3.appendChild(checkbox("Zen mode (esconder histórico)", a.zenMode, (v) => { a.zenMode = v; applyAppearance(a); onChange(); }));
  card3.appendChild(checkbox("Ambient glow (decoração com gradient)", a.ambientGlow, (v) => { a.ambientGlow = v; applyAppearance(a); onChange(); }));
  card3.appendChild(field("Animação reduzida", (() => {
    const s = select(
      [{ value: "auto", label: "Automático (segue sistema)" }, { value: "on", label: "Sempre reduzido" }, { value: "off", label: "Sempre completo" }],
      a.reducedMotion
    );
    s.addEventListener("change", () => { a.reducedMotion = s.value; applyAppearance(a); onChange(); });
    return s;
  })()));
  sec3.appendChild(card3);
  elements.settingsBody.appendChild(sec3);
}
