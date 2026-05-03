/* Theme application: data-theme, accent color, density, font size, radius,
   reduced motion, ambient glow, zen mode. All driven by appearance settings. */

export function applyAppearance(appearance) {
  const root = document.documentElement;

  // theme
  const theme = appearance.theme || "system";
  root.setAttribute("data-theme", theme);

  // density
  const density = appearance.density || "normal";
  root.setAttribute("data-density", density);

  // font size
  if (appearance.fontSize) {
    root.style.setProperty("--fs-base", `${appearance.fontSize}px`);
  } else {
    root.style.removeProperty("--fs-base");
  }

  // accent color (and a slightly darker strong + a soft variant)
  if (appearance.accentColor) {
    root.style.setProperty("--accent", appearance.accentColor);
    root.style.setProperty("--accent-strong", darken(appearance.accentColor, 12));
    root.style.setProperty("--accent-soft", hexAlpha(appearance.accentColor, 0.16));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-strong");
    root.style.removeProperty("--accent-soft");
  }

  // radius
  if (Number.isFinite(appearance.radius)) {
    root.style.setProperty("--r-md", `${appearance.radius}px`);
    root.style.setProperty("--r-lg", `${appearance.radius + 4}px`);
    root.style.setProperty("--r-sm", `${Math.max(2, appearance.radius - 4)}px`);
  } else {
    root.style.removeProperty("--r-md");
    root.style.removeProperty("--r-lg");
    root.style.removeProperty("--r-sm");
  }

  // reduced motion
  const rm = appearance.reducedMotion || "auto";
  if (rm === "on") root.setAttribute("data-reduced-motion", "on");
  else root.removeAttribute("data-reduced-motion");

  // zen mode
  if (appearance.zenMode) root.setAttribute("data-zen", "on");
  else root.removeAttribute("data-zen");

  // ambient glow (optional decorative)
  if (appearance.ambientGlow) root.setAttribute("data-ambient", "on");
  else root.removeAttribute("data-ambient");

  // font family
  if (appearance.fontUI && appearance.fontUI !== "system") {
    root.style.setProperty("--font-sans", appearance.fontUI);
  } else {
    root.style.removeProperty("--font-sans");
  }
  if (appearance.fontMono && appearance.fontMono !== "system") {
    root.style.setProperty("--font-mono", appearance.fontMono);
  } else {
    root.style.removeProperty("--font-mono");
  }
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(v, 16);
  return [num >> 16, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function darken(hex, percent) {
  const [r, g, b] = hexToRgb(hex);
  const factor = (100 - percent) / 100;
  return rgbToHex(r * factor, g * factor, b * factor);
}

function hexAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
