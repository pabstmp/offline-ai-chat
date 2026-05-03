/* File System Access API backend: showDirectoryPicker, persisted handle in IDB,
   permission re-prompt, lazy directory listing, file reading. */

import { handleStore } from "../storage.js";
import { isTextFile } from "./upload.js";
import { shouldIgnore } from "./dragdrop.js";

export function isSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory() {
  if (!isSupported()) throw new Error("File System Access API não suportada neste navegador.");
  const handle = await window.showDirectoryPicker({ mode: "read" });
  return handle;
}

export async function persistHandle(id, handle) {
  await handleStore.put(id, handle);
}

export async function loadHandle(id) {
  return await handleStore.get(id);
}

export async function ensurePermission(handle) {
  if (!handle) return false;
  const opts = { mode: "read" };
  const status = await handle.queryPermission(opts);
  if (status === "granted") return true;
  const requested = await handle.requestPermission(opts);
  return requested === "granted";
}

export async function listDirectory(handle, ignorePatterns = []) {
  const entries = [];
  for await (const [name, child] of handle.entries()) {
    if (shouldIgnore(name, ignorePatterns)) continue;
    entries.push({ name, kind: child.kind, handle: child });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function navigateTo(rootHandle, relPath) {
  if (!relPath) return rootHandle;
  const parts = relPath.split("/").filter(Boolean);
  let current = rootHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part);
  }
  return current;
}

export async function readFileAt(rootHandle, relPath, maxBytes = Infinity) {
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!isTextFile(fileName)) throw new Error("Arquivo não-texto.");
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  if (file.size > maxBytes) throw new Error("Arquivo excede o tamanho máximo.");
  const content = await file.text();
  return { path: relPath, name: fileName, size: file.size, content };
}

export async function collectAllFiles(handle, prefix = "", out = [], ignorePatterns = [], limits = {}) {
  const { maxFileBytes = Infinity, maxTotalBytes = Infinity } = limits;
  let totalBytes = 0;
  for (const f of out) totalBytes += f.size;
  for await (const [name, child] of handle.entries()) {
    if (totalBytes > maxTotalBytes) return out;
    if (shouldIgnore(name, ignorePatterns)) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "file") {
      if (!isTextFile(name)) continue;
      try {
        const file = await child.getFile();
        if (file.size > maxFileBytes) continue;
        if (totalBytes + file.size > maxTotalBytes) continue;
        const content = await file.text();
        out.push({ path: rel, name, size: file.size, content });
        totalBytes += file.size;
      } catch {}
    } else if (child.kind === "directory") {
      await collectAllFiles(child, rel, out, ignorePatterns, limits);
    }
  }
  return out;
}
