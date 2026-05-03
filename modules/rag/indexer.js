/* Indexer — orchestrates: enumerate files → read → chunk → embed → store.
   Reports progress via onProgress callback. Aborts via AbortSignal. */

import { chunkText } from "./chunker.js";
import { embedBatch } from "./embedder.js";
import { saveChunks, clearSource, setSourceMeta } from "./store.js";
import * as fsbridge from "../workspace/fsbridge.js";
import * as fsapi from "../workspace/fsapi.js";
import { isTextFile, isPdfFile, extractPdfFile } from "../workspace/upload.js";
import { shouldIgnore } from "../workspace/dragdrop.js";

/**
 * @param {object} args
 * @param {object} args.source       - { id, kind, label, root }
 * @param {object} args.embedConfig  - { baseUrl, apiKey, model, batchSize }
 * @param {object} args.workspace    - { ignorePatterns, maxFileBytes }
 * @param {object} args.ragConfig    - { chunkChars, chunkOverlap }
 * @param {AbortSignal} args.signal
 * @param {(s:{phase, message, processed, total, eta}) => void} args.onProgress
 */
export async function indexSource(args) {
  const { source, embedConfig, workspace, ragConfig, signal } = args;
  const onProgress = args.onProgress || (() => {});

  // Phase 1: clear old data for this source
  onProgress({ phase: "clearing", message: "Limpando índice anterior...", processed: 0, total: 0 });
  await clearSource(source.id);
  if (signal?.aborted) throw new Error("Cancelado");

  // Phase 2: enumerate files
  onProgress({ phase: "scanning", message: "Listando arquivos...", processed: 0, total: 0 });
  const files = await collectFiles(source, workspace);
  if (signal?.aborted) throw new Error("Cancelado");

  if (!files.length) {
    onProgress({ phase: "done", message: "Nenhum arquivo de texto encontrado", processed: 0, total: 0 });
    return { chunkCount: 0, fileCount: 0 };
  }

  // Phase 3: read + chunk
  onProgress({ phase: "reading", message: `Lendo ${files.length} arquivos...`, processed: 0, total: files.length });
  const allChunks = []; // [{ sourceId, fileId, path, chunkIdx, text, lineStart, lineEnd }]
  const ocrNeededFiles = []; // scanned PDFs we couldn't read (OCR off)
  const ocredFiles = [];     // scanned PDFs OCR'd successfully (OCR on)
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new Error("Cancelado");
    const file = files[i];
    let content;
    let readMeta;
    try {
      const r = await readFile(source, file, workspace);
      content = r.content;
      readMeta = r.meta;
    } catch (err) {
      console.warn(`Skipping ${file.path}: ${err.message}`);
      continue;
    }
    if (file.isPdf && readMeta?.ocrLikelyNeeded) {
      ocrNeededFiles.push(file.path);
    }
    if (file.isPdf && readMeta?.ocrApplied && (readMeta?.pagesOcred || 0) > 0) {
      ocredFiles.push({ path: file.path, pagesOcred: readMeta.pagesOcred });
    }
    const chunks = chunkText(content, {
      chunkChars: ragConfig.chunkChars,
      overlap: ragConfig.chunkOverlap,
      path: file.path,
    });
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const c = chunks[cIdx];
      allChunks.push({
        id: `${source.id}|${file.path}|${cIdx}`,
        sourceId: source.id,
        fileId: file.path,
        path: file.path,
        chunkIdx: cIdx,
        text: c.text,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
      });
    }
    onProgress({ phase: "reading", message: `Lendo ${i + 1}/${files.length}...`, processed: i + 1, total: files.length });
  }
  if (signal?.aborted) throw new Error("Cancelado");

  if (!allChunks.length) {
    onProgress({ phase: "done", message: "Nenhum chunk gerado", processed: 0, total: 0, ocrNeededFiles, ocredFiles });
    return { chunkCount: 0, fileCount: files.length, ocrNeededFiles, ocredFiles };
  }

  // Phase 4: embed
  const startEmbed = Date.now();
  onProgress({ phase: "embedding", message: `Embedando 0/${allChunks.length}...`, processed: 0, total: allChunks.length });
  const vecs = await embedBatch(allChunks.map((c) => c.text), {
    baseUrl: embedConfig.baseUrl,
    apiKey: embedConfig.apiKey,
    model: embedConfig.model,
    batchSize: embedConfig.batchSize || 32,
    signal,
    onProgress: (done, total) => {
      const elapsed = Date.now() - startEmbed;
      const rate = done / Math.max(1, elapsed); // chunks per ms
      const eta = rate > 0 ? Math.round((total - done) / rate / 1000) : null;
      onProgress({
        phase: "embedding",
        message: `Embedando ${done}/${total}${eta != null ? ` (ETA ~${eta}s)` : ""}...`,
        processed: done,
        total,
        eta,
      });
    },
  });

  if (signal?.aborted) throw new Error("Cancelado");
  if (!vecs.length) throw new Error("Nenhum vetor retornado pelo embedder");

  const dim = vecs[0].length;

  // Phase 5: persist
  onProgress({ phase: "saving", message: "Salvando no IndexedDB...", processed: 0, total: allChunks.length });
  // Save in batches to avoid one giant transaction
  const SAVE_BATCH = 200;
  for (let i = 0; i < allChunks.length; i += SAVE_BATCH) {
    if (signal?.aborted) throw new Error("Cancelado");
    const batch = allChunks.slice(i, i + SAVE_BATCH).map((c, idx) => ({
      ...c,
      vec: vecs[i + idx],
      dim,
    }));
    await saveChunks(source.id, batch);
    onProgress({ phase: "saving", message: `Salvando ${Math.min(i + SAVE_BATCH, allChunks.length)}/${allChunks.length}...`, processed: Math.min(i + SAVE_BATCH, allChunks.length), total: allChunks.length });
  }

  // Phase 6: meta
  await setSourceMeta({
    sourceId: source.id,
    embeddingModel: embedConfig.model,
    embeddingDim: dim,
    chunkCount: allChunks.length,
    fileCount: files.length,
    indexedAt: Date.now(),
  });

  onProgress({ phase: "done", message: `Indexado: ${allChunks.length} chunks de ${files.length} arquivos`, processed: allChunks.length, total: allChunks.length, ocrNeededFiles, ocredFiles });

  return { chunkCount: allChunks.length, fileCount: files.length, dim, ocrNeededFiles, ocredFiles };
}

/* ---------- file enumeration ---------- */

async function collectFiles(source, workspace) {
  const ignore = workspace.ignorePatterns || [];
  const maxFileBytes = workspace.maxFileBytes || 256 * 1024;

  if (source.kind === "server") {
    return await walkServer(source.root, "", ignore, maxFileBytes);
  }
  if (source.kind === "fs-api") {
    const handle = await fsapi.loadHandle(source.id);
    if (!handle) throw new Error("Handle FS API não encontrado");
    const granted = await fsapi.ensurePermission(handle);
    if (!granted) throw new Error("Permissão negada para a pasta");
    const collected = [];
    await walkFsApi(handle, "", collected, ignore, maxFileBytes);
    return collected;
  }
  // upload/dragdrop kinds aren't really persistent sources for indexing
  throw new Error(`Indexação não suportada para fontes do tipo "${source.kind}"`);
}

async function walkServer(root, relPath, ignore, maxFileBytes, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = await fsbridge.fsList(root, relPath);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (shouldIgnore(entry.name, ignore)) continue;
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.kind === "dir") {
      await walkServer(root, childRel, ignore, maxFileBytes, out, depth + 1);
    } else if (entry.kind === "file") {
      const isText = isTextFile(entry.name);
      const isPdf = isPdfFile(entry.name);
      if (!isText && !isPdf) continue;
      // PDFs get a higher size limit since they're inherently bigger
      const limit = isPdf ? Math.max(maxFileBytes, 32 * 1024 * 1024) : maxFileBytes;
      if (entry.size && entry.size > limit) continue;
      out.push({ path: childRel, kind: "server", isPdf });
    }
  }
  return out;
}

async function walkFsApi(handle, prefix, out, ignore, maxFileBytes, depth = 0) {
  if (depth > 12) return;
  for await (const [name, child] of handle.entries()) {
    if (shouldIgnore(name, ignore)) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "directory") {
      await walkFsApi(child, rel, out, ignore, maxFileBytes, depth + 1);
    } else if (child.kind === "file") {
      const isText = isTextFile(name);
      const isPdf = isPdfFile(name);
      if (!isText && !isPdf) continue;
      try {
        const f = await child.getFile();
        const limit = isPdf ? Math.max(maxFileBytes, 32 * 1024 * 1024) : maxFileBytes;
        if (f.size > limit) continue;
        out.push({ path: rel, kind: "fs-api", _handle: child, isPdf });
      } catch {}
    }
  }
}

async function readFile(source, file, workspace) {
  const maxFileBytes = workspace.maxFileBytes || 256 * 1024;
  const ocr = !!workspace.ocrEnabled;
  if (source.kind === "server") {
    if (file.isPdf) {
      const r = await fsbridge.fsReadPdf(source.root, file.path, { ocr });
      return { content: r.content, meta: { ocrLikelyNeeded: !!r.ocrLikelyNeeded, ocrApplied: !!r.ocrApplied, pagesEmpty: r.pagesEmpty, pagesWithText: r.pagesWithText, pagesOcred: r.pagesOcred } };
    }
    const r = await fsbridge.fsRead(source.root, file.path);
    return { content: r.content, meta: null };
  }
  if (source.kind === "fs-api") {
    if (file._handle) {
      const f = await file._handle.getFile();
      if (file.isPdf) {
        const extracted = await extractPdfFile(f, { ocr });
        return { content: extracted.content, meta: { ocrLikelyNeeded: !!extracted.meta?.ocrLikelyNeeded, ocrApplied: !!extracted.meta?.ocrApplied, pagesEmpty: extracted.meta?.pagesEmpty, pagesWithText: extracted.meta?.pagesWithText, pagesOcred: extracted.meta?.pagesOcred } };
      }
      if (f.size > maxFileBytes) throw new Error("Arquivo grande demais");
      return { content: await f.text(), meta: null };
    }
    const handle = await fsapi.loadHandle(source.id);
    const f = await fsapi.readFileAt(handle, file.path, maxFileBytes);
    return { content: f.content, meta: null };
  }
  throw new Error("Tipo de fonte não suportado");
}
