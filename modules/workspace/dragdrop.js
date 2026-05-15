/* Drag-and-drop backend: handles files and entire folders via webkitGetAsEntry,
   recursively walks directories with ignorePatterns filtering. */

import { isTextFile, isPdfFile, extractPdfFile } from "./upload.js";

export function shouldIgnore(name, patterns) {
  for (const p of patterns) {
    if (p.startsWith("*.")) {
      if (name.toLowerCase().endsWith(p.slice(1).toLowerCase())) return true;
    } else if (name === p) {
      return true;
    }
  }
  return false;
}

export function bindDragDrop({ container, ignorePatterns, maxFileBytes, maxTotalBytes, ocr, onFiles, onProgress }) {
  let dragCounter = 0;
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.display = "none";
  overlay.style.placeItems = "center";
  overlay.style.background = "rgba(0,0,0,0.4)";
  overlay.style.color = "white";
  overlay.style.fontSize = "var(--fs-xl)";
  overlay.style.fontWeight = "700";
  overlay.style.zIndex = "100";
  overlay.style.pointerEvents = "none";
  overlay.textContent = "Solte arquivos ou pastas aqui";
  document.body.appendChild(overlay);

  container.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter++;
    overlay.style.display = "grid";
  });

  container.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
  });

  container.addEventListener("dragleave", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.style.display = "none";
    }
  });

  container.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragCounter = 0;
    overlay.style.display = "none";

    const items = [...e.dataTransfer.items];
    const collected = [];
    let totalBytes = 0;

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (!entry) continue;
      await walkEntry(entry, "", collected, {
        ignorePatterns,
        maxFileBytes,
        maxTotalBytes,
        ocr,
        currentTotal: () => totalBytes,
        addBytes: (b) => { totalBytes += b; },
        onProgress,
      });
    }

    onFiles(collected);
  });
}

async function walkEntry(entry, prefix, collected, opts) {
  if (opts.currentTotal() > opts.maxTotalBytes) return;
  if (shouldIgnore(entry.name, opts.ignorePatterns)) return;

  if (entry.isFile) {
    const accepted = isTextFile(entry.name) || isPdfFile(entry.name);
    if (!accepted) return;
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    if (file.size > opts.maxFileBytes) return;
    if (opts.currentTotal() + file.size > opts.maxTotalBytes) return;
    try {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      let item;
      if (isPdfFile(entry.name)) {
        const extracted = await extractPdfFile(file, { ocr: opts.ocr });
        if (!extracted) return;
        item = { ...extracted, path: rel };
      } else {
        const content = await file.text();
        item = { path: rel, name: entry.name, size: file.size, content };
      }
      collected.push(item);
      opts.addBytes(file.size);
      opts.onProgress?.({ path: rel, totalFiles: collected.length, totalBytes: opts.currentTotal() });
    } catch (err) {
      console.warn(`Skipping ${entry.name}: ${err.message}`);
    }
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let done = false;
    while (!done) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) { done = true; break; }
      for (const child of batch) {
        await walkEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name, collected, opts);
      }
    }
  }
}
