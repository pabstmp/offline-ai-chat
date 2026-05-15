/* Upload backend: <input type="file" multiple> reads selected files as text.
   Special handling for PDFs: server-side extraction via /api/extract-pdf. */

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".swift", ".dart",
  ".c", ".h", ".cpp", ".hpp", ".cs",
  ".html", ".htm", ".xml", ".css", ".scss", ".sass", ".less",
  ".json", ".yml", ".yaml", ".toml", ".ini", ".env", ".cfg", ".conf",
  ".md", ".mdx", ".rst", ".txt", ".log",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".graphql", ".gql", ".proto",
  ".vue", ".svelte", ".astro",
  ".lock", ".tf",
]);

const PDF_EXT = ".pdf";

export function isTextFile(name) {
  if (!name) return false;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return TEXT_EXT.has(ext);
}

export function isPdfFile(name) {
  if (!name) return false;
  return name.toLowerCase().endsWith(PDF_EXT);
}

export function isAcceptedFile(name) {
  return isTextFile(name) || isPdfFile(name);
}

export function pickFiles(opts = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pdf,.txt,.md,.json,.yml,.yaml,.toml,.csv,.html,.css,.js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.c,.h,.cpp,.sh,.sql";
    input.addEventListener("change", async () => {
      const result = { files: [], skipped: [] };
      result.files = await readFiles(
        [...input.files],
        { maxBytes: opts.maxBytes || Infinity, ocr: opts.ocr },
        (skipped) => { result.skipped = skipped; }
      );
      resolve(result);
    });
    input.click();
  });
}

export async function readFiles(fileList, opts = {}, onSkipped) {
  const result = [];
  const skipped = [];
  const maxBytes = opts.maxBytes || Infinity;
  // PDFs get a higher size limit since they're inherently bigger
  const PDF_LIMIT = Math.max(maxBytes, 32 * 1024 * 1024); // 32 MB for PDFs

  for (const f of fileList) {
    try {
      if (isPdfFile(f.name)) {
        if (f.size > PDF_LIMIT) {
          skipped.push({ name: f.name, reason: `excede limite de PDF (${formatSize(PDF_LIMIT)})` });
          continue;
        }
        const extracted = await extractPdfFile(f, { ocr: opts.ocr });
        if (extracted) result.push(extracted);
      } else if (isTextFile(f.name)) {
        if (f.size > maxBytes) {
          skipped.push({ name: f.name, reason: `excede limite (${formatSize(maxBytes)})` });
          continue;
        }
        const content = await f.text();
        result.push({
          path: f.webkitRelativePath || f.name,
          name: f.name,
          size: f.size,
          content,
        });
      } else {
        skipped.push({ name: f.name, reason: "tipo não suportado" });
      }
    } catch (err) {
      console.warn(`Skipping ${f.name}: ${err.message}`);
      skipped.push({ name: f.name, reason: err.message });
    }
  }
  if (onSkipped && skipped.length) onSkipped(skipped);
  return result;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* Extract PDF text by calling server-side endpoint. Pass opts.ocr=true
   to apply Tesseract OCR on pages without an extractable text layer. */
export async function extractPdfFile(file, opts = {}) {
  if (!isPdfFile(file.name)) throw new Error("Não é PDF");
  const buf = await file.arrayBuffer();
  const dataBase64 = bufferToBase64(buf);
  const response = await fetch("/api/extract-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataBase64, name: file.name, ocr: !!opts.ocr }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Falha na extração de PDF (${response.status})`);
  }
  const data = await response.json();
  return {
    path: file.webkitRelativePath || file.name,
    name: file.name,
    size: file.size,
    content: data.content || "",
    meta: {
      kind: "pdf",
      pageCount: data.pageCount,
      extractedPages: data.extractedPages,
      pagesWithText: data.pagesWithText,
      pagesEmpty: data.pagesEmpty,
      pagesOcred: data.pagesOcred,
      ocrApplied: !!data.ocrApplied,
      ocrLikelyNeeded: !!data.ocrLikelyNeeded,
      truncated: data.truncated,
    },
  };
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
