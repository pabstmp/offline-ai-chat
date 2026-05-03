/* Context manager: tracks attached files (path + content) for next prompt.
   Computes total tokens, dedups by source+path, builds <workspace_context>
   block to prepend to user message. */

import { estimateTokens } from "../markdown.js";

const files = new Map(); // key: sourceId|path -> { sourceId, sourceLabel, path, content, tokens }
let persistAcrossMessages = false;
const subscribers = new Set();

export function subscribeContext(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify() {
  subscribers.forEach((fn) => fn(getContextSummary()));
}

export function setPersistAcrossMessages(value) {
  persistAcrossMessages = !!value;
  notify();
}

export function isPersistAcrossMessages() {
  return persistAcrossMessages;
}

export function addFile({ sourceId = "upload", sourceLabel = "Upload", path, content, size }) {
  const key = `${sourceId}|${path}`;
  const tokens = estimateTokens(content);
  files.set(key, { sourceId, sourceLabel, path, content, tokens, size: size ?? content.length });
  notify();
}

export function addFiles(items, sourceId, sourceLabel) {
  for (const it of items) {
    addFile({
      sourceId: sourceId || "upload",
      sourceLabel: sourceLabel || "Upload",
      path: it.path,
      content: it.content,
      size: it.size,
    });
  }
}

export function removeFile(sourceId, path) {
  files.delete(`${sourceId}|${path}`);
  notify();
}

export function clearFiles() {
  files.clear();
  notify();
}

export function listFiles() {
  return [...files.values()];
}

export function getContextSummary() {
  const list = listFiles();
  const totalTokens = list.reduce((acc, f) => acc + f.tokens, 0);
  const totalBytes = list.reduce((acc, f) => acc + f.size, 0);
  return { files: list, totalTokens, totalBytes, count: list.length };
}

export function buildContextBlock() {
  const list = listFiles();
  if (!list.length) return "";
  const parts = ["<workspace_context>"];
  parts.push("Arquivos do projeto incluídos no contexto desta mensagem:");
  parts.push("");
  for (const f of list) {
    parts.push(`[arquivo: ${f.path}]`);
    parts.push(f.content);
    parts.push("[fim]");
    parts.push("");
  }
  parts.push("</workspace_context>");
  return parts.join("\n");
}

export function injectContextIntoMessage(userMessage) {
  const block = buildContextBlock();
  if (!block) return userMessage;
  return `${block}\n\nPergunta do usuário: ${userMessage}`;
}

/* Slash commands: /include <path>, /clear-context */
export function handleSlashContext(text, { activeSource, sourceList, readFromSource }) {
  if (text.trim() === "/clear-context") {
    clearFiles();
    return { handled: true, message: "Contexto limpo." };
  }
  const m = text.match(/^\/include\s+(.+)$/);
  if (m && activeSource && readFromSource) {
    const relPath = m[1].trim();
    return readFromSource(activeSource, relPath)
      .then((file) => {
        addFile({
          sourceId: activeSource.id,
          sourceLabel: activeSource.label,
          path: relPath,
          content: file.content,
          size: file.size,
        });
        return { handled: true, message: `Adicionado: ${relPath}` };
      })
      .catch((err) => ({ handled: true, message: `Erro: ${err.message}`, isError: true }));
  }
  return { handled: false };
}
