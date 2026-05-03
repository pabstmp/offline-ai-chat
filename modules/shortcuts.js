/* Shortcuts engine: maps action names to key chords, handles capture mode for
   reconfiguration in the Shortcuts settings tab. */

const actionHandlers = new Map();

export function registerAction(name, handler) {
  actionHandlers.set(name, handler);
}

export function unregisterAction(name) {
  actionHandlers.delete(name);
}

let currentKeymap = {};

export function setKeymap(keymap) {
  currentKeymap = { ...keymap };
}

export function chordFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

export function bindGlobalShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (isCapturingChord) return; // capture mode owns events
    const target = e.target;
    const inEditable =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    const chord = chordFromEvent(e);

    for (const [action, binding] of Object.entries(currentKeymap)) {
      if (!binding) continue;
      if (chord !== binding) continue;
      // some actions are safe in editable fields (e.g., Escape)
      const allowInEditable = ["stopStream", "openPalette", "openSettings", "newChat"];
      if (inEditable && !allowInEditable.includes(action)) continue;
      const handler = actionHandlers.get(action);
      if (handler) {
        e.preventDefault();
        handler(e);
        return;
      }
    }
  });
}

let isCapturingChord = false;
let captureResolve = null;

export function captureChord() {
  if (isCapturingChord) {
    captureResolve?.(null);
  }
  return new Promise((resolve) => {
    isCapturingChord = true;
    captureResolve = resolve;
    const handler = (e) => {
      // ignore plain modifier presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      const chord = chordFromEvent(e);
      document.removeEventListener("keydown", handler, true);
      isCapturingChord = false;
      captureResolve = null;
      resolve(chord);
    };
    document.addEventListener("keydown", handler, true);
  });
}
