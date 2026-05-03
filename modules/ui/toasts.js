/* Toast notifications. */

let container = null;

export function initToasts(el) {
  container = el;
}

export function toast(message, kind = "info", durationMs = 3500) {
  if (!container) return;
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.setAttribute("role", "status");
  node.textContent = message;
  container.appendChild(node);
  setTimeout(() => {
    node.style.transition = "opacity 200ms";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 220);
  }, durationMs);
}
