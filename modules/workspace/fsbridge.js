/* Server-side fs backend: client for /api/fs/list, /api/fs/read, /api/fs/search */

export async function fsList(sourceRoot, relPath = "") {
  const r = await fetch("/api/fs/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceRoot, relPath }),
  });
  if (!r.ok) throw new Error((await safeJson(r))?.error?.message || `HTTP ${r.status}`);
  return (await r.json()).entries || [];
}

export async function fsRead(sourceRoot, relPath) {
  const r = await fetch("/api/fs/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceRoot, relPath }),
  });
  if (!r.ok) throw new Error((await safeJson(r))?.error?.message || `HTTP ${r.status}`);
  return await r.json();
}

/* Read PDF from disk + extract text in one round-trip. Pass ocr=true
   to apply Tesseract OCR on pages without an extractable text layer. */
export async function fsReadPdf(sourceRoot, relPath, opts = {}) {
  const r = await fetch("/api/fs/read-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceRoot, relPath, ocr: !!opts.ocr }),
  });
  if (!r.ok) throw new Error((await safeJson(r))?.error?.message || `HTTP ${r.status}`);
  return await r.json();
}

export async function fsSearch(sourceRoot, query, limit = 100, relPath = "") {
  const r = await fetch("/api/fs/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceRoot, relPath, query, limit }),
  });
  if (!r.ok) throw new Error((await safeJson(r))?.error?.message || `HTTP ${r.status}`);
  return (await r.json()).matches || [];
}

async function safeJson(response) {
  try { return await response.json(); }
  catch { return null; }
}
