/* Workspace UI: file tree sidebar (FS API or server bridge), upload button,
   drag-and-drop init, context panel above composer, slash command integration. */

import * as upload from "../workspace/upload.js";
import * as dragdrop from "../workspace/dragdrop.js";
import * as fsapi from "../workspace/fsapi.js";
import * as fsbridge from "../workspace/fsbridge.js";
import {
  addFiles,
  addFile,
  removeFile,
  clearFiles,
  getContextSummary,
  subscribeContext,
  setPersistAcrossMessages,
  isPersistAcrossMessages,
  handleSlashContext,
} from "../workspace/context.js";
import { toast } from "./toasts.js";

let elements = null;
let store = null;
let onAttachClicked = null;

let workspaceSidebar = null;
let activeSource = null; // { id, kind, label, root, handle? }

export function initWorkspace(opts) {
  elements = opts.elements;
  store = opts.store;

  const ws = store.get("workspace") || {};

  // attach button (in composer bar)
  if (elements.attachButton) {
    elements.attachButton.addEventListener("click", async () => {
      const result = await upload.pickFiles({ maxBytes: ws.maxFileBytes, ocr: !!ws.ocrEnabled });
      const files = result.files || result; // backwards-compat
      const skipped = result.skipped || [];
      if (files.length) {
        addFiles(files, "upload", "Upload");
        toast(`${files.length} arquivo(s) adicionado(s) ao contexto`, "success");
      }
      if (skipped.length) {
        const summary = skipped.slice(0, 3).map((s) => `${s.name}: ${s.reason}`).join("; ");
        const more = skipped.length > 3 ? ` (+${skipped.length - 3} outros)` : "";
        toast(`${skipped.length} arquivo(s) pulado(s). ${summary}${more}`, "warn", 6000);
      }
      if (!files.length && !skipped.length) {
        // nothing happened — user cancelled the picker
      }
    });
  }

  // drag-and-drop
  dragdrop.bindDragDrop({
    container: document.body,
    ignorePatterns: ws.ignorePatterns || [],
    maxFileBytes: ws.maxFileBytes || 256 * 1024,
    maxTotalBytes: ws.maxTotalBytes || 4 * 1024 * 1024,
    ocr: !!ws.ocrEnabled,
    onFiles: (files) => {
      if (files.length) {
        addFiles(files, "dragdrop", "Drag-and-drop");
        toast(`${files.length} arquivo(s) adicionado(s)`, "success");
      } else {
        toast("Nenhum arquivo de texto identificado", "warn");
      }
    },
  });

  // context panel subscriber
  subscribeContext(renderContextPanel);
  renderContextPanel(getContextSummary());

  // workspace sidebar (created lazily on toggle)
  if (elements.workspaceToggle) {
    elements.workspaceToggle.addEventListener("click", toggleWorkspaceSidebar);
  }
}

function renderContextPanel(summary) {
  if (!elements.contextPanel) return;
  const ws = store.get("workspace") || {};
  // Use a more realistic ceiling: typical LM Studio default ctx is 4096 tokens,
  // model can be configured up to 128k. We warn at 3500 (close to 4k default).
  const SAFE_LIMIT = 3500;   // green
  const WARN_LIMIT = 7000;   // yellow — needs ctx >= 8k
  const DANGER_LIMIT = 16000; // red — needs ctx >= 16k or RAG
  if (!summary.count) {
    elements.contextPanel.classList.add("hidden");
    elements.contextPanel.replaceChildren();
    return;
  }
  elements.contextPanel.classList.remove("hidden");
  const panel = document.createElement("div");
  panel.className = "context-panel";

  // Token warning level
  let level = "ok";
  if (summary.totalTokens > DANGER_LIMIT) level = "danger";
  else if (summary.totalTokens > WARN_LIMIT) level = "warn";
  else if (summary.totalTokens > SAFE_LIMIT) level = "soft-warn";

  if (level === "warn" || level === "danger") {
    const warn = document.createElement("div");
    warn.style.padding = "var(--s-2) var(--s-3)";
    warn.style.borderRadius = "var(--r-sm)";
    warn.style.fontSize = "var(--fs-xs)";
    warn.style.marginBottom = "var(--s-2)";
    if (level === "danger") {
      warn.style.background = "var(--danger-soft)";
      warn.style.color = "var(--danger)";
      warn.innerHTML = `⚠ <strong>~${summary.totalTokens} tokens</strong> excede context window típico (4k–8k). Provavelmente vai dar "(servidor sem conteúdo)". Use <strong>RAG</strong> (indexar) ou aumente o context length no LM Studio.`;
    } else {
      warn.style.background = "rgba(251, 191, 36, 0.12)";
      warn.style.color = "var(--warn)";
      warn.innerHTML = `⚠ ~${summary.totalTokens} tokens — pode estourar se o modelo no LM Studio tem ctx menor que 8k. Considere usar RAG.`;
    }
    panel.appendChild(warn);
  } else if (level === "soft-warn") {
    const warn = document.createElement("div");
    warn.style.padding = "var(--s-1) var(--s-3)";
    warn.style.fontSize = "var(--fs-xs)";
    warn.style.color = "var(--fg-2)";
    warn.style.marginBottom = "var(--s-1)";
    warn.textContent = `~${summary.totalTokens} tokens — bem perto do limite default (4k) do LM Studio. Verifique seu context length se estourar.`;
    panel.appendChild(warn);
  }

  const summaryRow = document.createElement("div");
  summaryRow.className = "context-summary";
  const label = document.createElement("strong");
  if (level === "danger") {
    label.style.color = "var(--danger)";
  } else if (level === "warn") {
    label.style.color = "var(--warn)";
  }
  label.textContent = `📁 Contexto: ${summary.count} arquivo(s) · ~${summary.totalTokens} tok`;
  summaryRow.appendChild(label);

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  summaryRow.appendChild(spacer);

  const persistLabel = document.createElement("label");
  persistLabel.className = "checkbox-row";
  persistLabel.style.fontSize = "var(--fs-xs)";
  const persistInput = document.createElement("input");
  persistInput.type = "checkbox";
  persistInput.checked = isPersistAcrossMessages();
  persistInput.addEventListener("change", () => setPersistAcrossMessages(persistInput.checked));
  persistLabel.appendChild(persistInput);
  const persistText = document.createElement("span");
  persistText.textContent = "Manter em todas";
  persistLabel.appendChild(persistText);
  summaryRow.appendChild(persistLabel);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-ghost btn-sm";
  clearBtn.textContent = "Limpar";
  clearBtn.addEventListener("click", () => clearFiles());
  summaryRow.appendChild(clearBtn);

  panel.appendChild(summaryRow);

  for (const f of summary.files) {
    const row = document.createElement("div");
    row.className = "context-file";
    const tag = document.createElement("span");
    tag.className = "context-file-path";
    tag.textContent = `${f.sourceLabel}: ${f.path}`;
    const tokens = document.createElement("span");
    tokens.className = "context-file-tokens";
    tokens.textContent = `${f.tokens} tok`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-ghost btn-sm";
    remove.textContent = "×";
    remove.addEventListener("click", () => removeFile(f.sourceId, f.path));
    row.appendChild(tag);
    row.appendChild(tokens);
    row.appendChild(remove);
    panel.appendChild(row);
  }

  // border color reflects warning level (uses level set above)
  if (level === "danger") panel.style.borderColor = "var(--danger)";
  else if (level === "warn") panel.style.borderColor = "var(--warn)";
  else panel.style.borderColor = "";

  elements.contextPanel.replaceChildren(panel);
}

/* ---------- workspace sidebar (file tree) ---------- */

function toggleWorkspaceSidebar() {
  if (workspaceSidebar) {
    workspaceSidebar.remove();
    workspaceSidebar = null;
    return;
  }
  workspaceSidebar = createWorkspaceSidebar();
  document.body.appendChild(workspaceSidebar);
}

function createWorkspaceSidebar() {
  const ws = store.get("workspace") || {};
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  aside.style.position = "fixed";
  aside.style.top = "var(--topbar-h)";
  aside.style.right = "0";
  aside.style.bottom = "0";
  aside.style.width = "min(360px, 90vw)";
  aside.style.zIndex = "11";
  aside.style.boxShadow = "var(--shadow-3)";
  aside.style.borderLeft = "1px solid var(--line)";
  aside.style.borderRight = "0";
  aside.style.background = "var(--bg-1)";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.gap = "var(--s-2)";
  header.style.alignItems = "center";

  const title = document.createElement("strong");
  title.textContent = "Workspace";
  header.appendChild(title);
  const sp = document.createElement("span");
  sp.style.flex = "1";
  header.appendChild(sp);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-ghost btn-sm";
  close.textContent = "×";
  close.addEventListener("click", () => toggleWorkspaceSidebar());
  header.appendChild(close);
  aside.appendChild(header);

  // source picker
  const sourceSelect = document.createElement("select");
  for (const s of ws.sources || []) {
    sourceSelect.appendChild(new Option(s.label, s.id));
  }
  if (!ws.sources?.length) {
    sourceSelect.appendChild(new Option("(nenhuma fonte adicionada)", ""));
  }
  sourceSelect.value = activeSource?.id || ws.activeSourceId || sourceSelect.value;
  sourceSelect.addEventListener("change", async () => {
    const id = sourceSelect.value;
    const src = (ws.sources || []).find((s) => s.id === id);
    if (src) {
      await activateSource(src);
      renderTree(treeContainer);
    }
  });
  aside.appendChild(sourceSelect);

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Buscar arquivo (Ctrl+P)";
  search.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && search.value.trim() && activeSource) {
      const query = search.value.trim();
      try {
        if (activeSource.kind === "server") {
          const results = await fsbridge.fsSearch(activeSource.root, query);
          renderSearchResults(treeContainer, results, query);
        } else {
          toast("Busca server-side requer fonte do servidor.", "warn");
        }
      } catch (err) {
        toast(err.message, "error");
      }
    }
  });
  aside.appendChild(search);

  const treeContainer = document.createElement("div");
  treeContainer.style.flex = "1";
  treeContainer.style.overflowY = "auto";
  treeContainer.style.fontFamily = "var(--font-mono)";
  treeContainer.style.fontSize = "var(--fs-sm)";
  aside.appendChild(treeContainer);

  // initial source = activeSource or first available
  const source = activeSource || (ws.sources || []).find((s) => s.id === ws.activeSourceId) || (ws.sources || [])[0];
  if (source) {
    activateSource(source).then(() => renderTree(treeContainer));
  } else {
    treeContainer.textContent = "Adicione uma fonte na aba Workspace das Configurações.";
    treeContainer.style.color = "var(--fg-2)";
  }

  return aside;
}

async function activateSource(src) {
  if (src.kind === "fs-api") {
    const handle = await fsapi.loadHandle(src.id);
    if (!handle) {
      toast("Handle não encontrado, selecione a pasta novamente.", "warn");
      return;
    }
    const granted = await fsapi.ensurePermission(handle);
    if (!granted) {
      toast("Permissão negada para a pasta.", "error");
      return;
    }
    activeSource = { ...src, handle };
  } else {
    activeSource = { ...src };
  }
  store.set("workspace.activeSourceId", src.id);
}

async function renderTree(container) {
  container.replaceChildren();
  if (!activeSource) {
    container.textContent = "Nenhuma fonte ativa.";
    return;
  }
  if (activeSource.kind === "fs-api") {
    const node = await renderFsApiNode(activeSource.handle, "");
    container.appendChild(node);
  } else if (activeSource.kind === "server") {
    const node = await renderServerNode(activeSource.root, "");
    container.appendChild(node);
  } else {
    container.textContent = "Fonte de upload não tem árvore.";
  }
}

async function renderFsApiNode(dirHandle, prefix) {
  const ws = store.get("workspace") || {};
  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.paddingLeft = "var(--s-3)";
  try {
    const entries = await fsapi.listDirectory(dirHandle, ws.ignorePatterns || []);
    for (const entry of entries) {
      ul.appendChild(buildTreeItem(entry, prefix, async (path) => {
        const file = await fsapi.readFileAt(activeSource.handle, path, ws.maxFileBytes);
        addFile({ sourceId: activeSource.id, sourceLabel: activeSource.label, path, content: file.content, size: file.size });
        toast(`Incluído: ${path}`, "success");
      }, async (childPrefix, childHandle) => renderFsApiNode(childHandle, childPrefix), {
        forFsApi: true,
      }));
    }
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = `Erro: ${err.message}`;
    li.style.color = "var(--danger)";
    ul.appendChild(li);
  }
  return ul;
}

async function renderServerNode(sourceRoot, relPath) {
  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.paddingLeft = "var(--s-3)";
  try {
    const entries = await fsbridge.fsList(sourceRoot, relPath);
    for (const entry of entries) {
      const fullRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      ul.appendChild(buildTreeItem(
        { name: entry.name, kind: entry.kind === "dir" ? "directory" : "file" },
        relPath,
        async () => {
          const isPdf = fullRel.toLowerCase().endsWith(".pdf");
          let file;
          if (isPdf) {
            const ws = store.get("workspace") || {};
            file = await fsbridge.fsReadPdf(sourceRoot, fullRel, { ocr: !!ws.ocrEnabled });
            if (file.meta?.ocrLikelyNeeded && !file.meta?.ocrApplied) {
              toast("Documento parece escaneado. Ative OCR no Workspace.", "warn", 6000);
            }
            if (file.meta?.ocrApplied) {
              toast(`OCR aplicado em ${file.meta.pagesOcred} página(s)`, "info");
            }
          } else {
            file = await fsbridge.fsRead(sourceRoot, fullRel);
          }
          addFile({ sourceId: activeSource.id, sourceLabel: activeSource.label, path: fullRel, content: file.content, size: file.size });
          toast(`Incluído: ${fullRel}`, "success");
        },
        async () => renderServerNode(sourceRoot, fullRel),
        { forFsApi: false }
      ));
    }
  } catch (err) {
    const li = document.createElement("li");
    li.textContent = `Erro: ${err.message}`;
    li.style.color = "var(--danger)";
    ul.appendChild(li);
  }
  return ul;
}

function buildTreeItem(entry, prefix, onSelectFile, expandChildren, opts) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "var(--s-1)";
  row.style.padding = "2px 0";
  row.style.cursor = "pointer";
  const icon = document.createElement("span");
  icon.style.width = "16px";
  icon.textContent = entry.kind === "directory" ? "📁" : "📄";
  const label = document.createElement("span");
  label.textContent = entry.name;
  row.appendChild(icon);
  row.appendChild(label);
  li.appendChild(row);

  if (entry.kind === "directory") {
    let expanded = false;
    let children = null;
    row.addEventListener("click", async () => {
      if (expanded) {
        children?.remove();
        children = null;
        expanded = false;
        icon.textContent = "📁";
      } else {
        icon.textContent = "📂";
        const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        children = await expandChildren(childPrefix, entry.handle);
        li.appendChild(children);
        expanded = true;
      }
    });
  } else {
    row.addEventListener("click", async () => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      try { await onSelectFile(path); }
      catch (err) { toast(err.message, "error"); }
    });
  }
  return li;
}

function renderSearchResults(container, results, query) {
  container.replaceChildren();
  const heading = document.createElement("div");
  heading.style.padding = "var(--s-2)";
  heading.style.color = "var(--fg-2)";
  heading.textContent = `${results.length} resultado(s) para "${query}"`;
  container.appendChild(heading);
  for (const m of results) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
    item.style.flexDirection = "column";
    item.style.alignItems = "flex-start";
    const path = document.createElement("strong");
    path.textContent = `${m.path}:${m.line}`;
    const snippet = document.createElement("code");
    snippet.style.fontSize = "var(--fs-xs)";
    snippet.style.color = "var(--fg-2)";
    snippet.textContent = m.snippet;
    item.appendChild(path);
    item.appendChild(snippet);
    item.addEventListener("click", async () => {
      try {
        const isPdf = m.path.toLowerCase().endsWith(".pdf");
        let file;
        if (isPdf) {
          const ws = store.get("workspace") || {};
          file = await fsbridge.fsReadPdf(activeSource.root, m.path, { ocr: !!ws.ocrEnabled });
          if (file.meta?.ocrLikelyNeeded && !file.meta?.ocrApplied) {
            toast("Documento parece escaneado. Ative OCR no Workspace.", "warn", 6000);
          }
          if (file.meta?.ocrApplied) {
            toast(`OCR aplicado em ${file.meta.pagesOcred} página(s)`, "info");
          }
        } else {
          file = await fsbridge.fsRead(activeSource.root, m.path);
        }
        addFile({ sourceId: activeSource.id, sourceLabel: activeSource.label, path: m.path, content: file.content, size: file.size });
        toast(`Incluído: ${m.path}`, "success");
      } catch (err) { toast(err.message, "error"); }
    });
    container.appendChild(item);
  }
}

/* ---------- public: process slash commands before submit ---------- */
export async function preprocessSlashCommands(text) {
  const ws = store.get("workspace") || {};
  const sources = ws.sources || [];
  const active = sources.find((s) => s.id === ws.activeSourceId);
  if (!active) {
    return handleSlashContext(text, { activeSource: null });
  }

  const readFromSource = async (src, relPath) => {
    if (src.kind === "fs-api") {
      const handle = await fsapi.loadHandle(src.id);
      if (!handle) throw new Error("Handle FS API perdido.");
      const granted = await fsapi.ensurePermission(handle);
      if (!granted) throw new Error("Permissão negada.");
      return await fsapi.readFileAt(handle, relPath, ws.maxFileBytes);
    }
    if (src.kind === "server") {
      return await fsbridge.fsRead(src.root, relPath);
    }
    throw new Error("Fonte não suporta /include.");
  };

  return handleSlashContext(text, { activeSource: active, sourceList: sources, readFromSource });
}
