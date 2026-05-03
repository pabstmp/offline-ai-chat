/* Code-aware text chunker.
   Splits text into chunks of ~chunkChars with overlap. Tracks line numbers.
   For code files, prefers cutting at function/class boundaries. */

const BOUNDARY_RE = /\n(?=(?:export\s+)?(?:async\s+)?(?:class|function|def|interface|struct|enum|fn|impl|module|namespace|public|private|protected|const|let|var)\s)/;

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".swift", ".dart",
  ".c", ".h", ".cpp", ".hpp", ".cs", ".scala",
]);

export function isCodeFile(path) {
  if (!path) return false;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return CODE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Chunk text. Returns [{text, lineStart, lineEnd, charStart, charEnd}].
 *
 * Algorithm:
 *  - If text fits in one chunk, return single chunk
 *  - For code files, find boundary positions (function/class starts)
 *  - Greedy pack: keep adding text until exceeding chunkChars
 *  - When boundary close to limit found, prefer cutting there
 *  - Otherwise, cut at chunkChars and rewind by overlap
 *
 * @param {string} text
 * @param {object} opts
 * @param {number} opts.chunkChars - target chunk size in chars (~600 tokens)
 * @param {number} opts.overlap - overlap between chunks
 * @param {string} opts.path - file path (used to detect language)
 */
export function chunkText(text, opts = {}) {
  const chunkChars = Math.max(200, opts.chunkChars || 2400);
  const overlap = Math.max(0, Math.min(opts.overlap || 400, Math.floor(chunkChars / 2)));
  const path = opts.path || "";

  if (!text || typeof text !== "string") return [];
  if (text.length <= chunkChars) {
    return [{
      text,
      lineStart: 1,
      lineEnd: countLines(text),
      charStart: 0,
      charEnd: text.length,
    }];
  }

  // Build lookup: char-index → line number (1-based)
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  const codeMode = isCodeFile(path);
  const boundaries = codeMode ? findBoundaries(text) : [];

  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const targetEnd = Math.min(cursor + chunkChars, text.length);
    let cutAt = targetEnd;

    if (cutAt < text.length) {
      // Try to find a boundary within [cursor + chunkChars*0.6, cursor + chunkChars]
      const minCut = cursor + Math.floor(chunkChars * 0.6);
      if (codeMode) {
        const bound = findNearestBoundary(boundaries, minCut, targetEnd);
        if (bound !== -1) cutAt = bound;
      }
      // If still no good cut, prefer newline near targetEnd
      if (cutAt === targetEnd) {
        const nl = text.lastIndexOf("\n", targetEnd);
        if (nl > minCut) cutAt = nl + 1;
      }
    }

    const chunkText = text.slice(cursor, cutAt);
    chunks.push({
      text: chunkText,
      lineStart: lineFor(lineStarts, cursor),
      lineEnd: lineFor(lineStarts, Math.max(cursor, cutAt - 1)),
      charStart: cursor,
      charEnd: cutAt,
    });

    if (cutAt >= text.length) break;
    cursor = Math.max(cutAt - overlap, cursor + 1);
  }

  return chunks;
}

function findBoundaries(text) {
  const positions = [];
  // start of file is always a virtual boundary
  positions.push(0);
  let lastIdx = 0;
  while (true) {
    const slice = text.slice(lastIdx);
    const match = slice.match(BOUNDARY_RE);
    if (!match) break;
    const pos = lastIdx + match.index + 1; // +1 to skip the leading \n
    positions.push(pos);
    lastIdx = pos;
  }
  positions.push(text.length);
  return positions;
}

function findNearestBoundary(boundaries, minPos, maxPos) {
  // Find the largest boundary <= maxPos and >= minPos
  let best = -1;
  for (const b of boundaries) {
    if (b >= minPos && b <= maxPos && b > best) best = b;
  }
  return best;
}

function lineFor(lineStarts, charPos) {
  // Binary search
  let lo = 0, hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= charPos) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, lo); // 1-based
}

function countLines(text) {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}
