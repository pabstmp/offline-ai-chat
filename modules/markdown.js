/* Mini markdown renderer — zero deps.
   Supports: fenced code blocks, headings, ordered/unordered lists, blockquote,
   horizontal rule, bold, italic, inline code, links.
   Sanitization by construction: never uses innerHTML with user content,
   builds DOM via document.createElement + textContent. */

export function renderMarkdown(text) {
  const root = document.createDocumentFragment();
  if (!text) return root;

  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fenceMatch = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      i++;
      const codeLines = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (lang) code.className = `lang-${lang}`;
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "code-copy";
      copyBtn.textContent = "Copiar";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard?.writeText(code.textContent || "");
        copyBtn.textContent = "Copiado";
        setTimeout(() => { copyBtn.textContent = "Copiar"; }, 1200);
      });
      pre.appendChild(copyBtn);

      root.appendChild(pre);
      continue;
    }

    // heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const h = document.createElement(`h${level}`);
      appendInline(h, hMatch[2]);
      root.appendChild(h);
      i++;
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(line.trim())) {
      root.appendChild(document.createElement("hr"));
      i++;
      continue;
    }

    // table (GFM): line with | followed by separator line
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const tbl = document.createElement("table");
      tbl.className = "msg-table";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      for (const cell of headerCells) {
        const th = document.createElement("th");
        appendInline(th, cell);
        trh.appendChild(th);
      }
      thead.appendChild(trh);
      tbl.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          appendInline(td, cell);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      root.appendChild(tbl);
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const bq = document.createElement("blockquote");
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const inner = renderMarkdown(buf.join("\n"));
      bq.appendChild(inner);
      root.appendChild(bq);
      continue;
    }

    // unordered list
    if (/^[-*+]\s+/.test(line)) {
      const ul = document.createElement("ul");
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendInline(li, lines[i].replace(/^[-*+]\s+/, ""));
        ul.appendChild(li);
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const ol = document.createElement("ol");
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const li = document.createElement("li");
        appendInline(li, lines[i].replace(/^\d+\.\s+/, ""));
        ol.appendChild(li);
        i++;
      }
      root.appendChild(ol);
      continue;
    }

    // empty line: paragraph break
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph: collect consecutive non-empty non-special lines
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    appendInline(p, pLines.join(" "));
    root.appendChild(p);
  }

  return root;
}

/* Inline rendering: handle code, bold, italic, links. Builds nodes safely. */
function parseTableRow(line) {
  // Trim outer | if present, split by |
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function appendInline(parent, text) {
  // tokenize: code -> bold -> italic -> link
  const tokens = tokenizeInline(text);
  for (const tk of tokens) {
    if (tk.type === "text") {
      parent.appendChild(document.createTextNode(tk.value));
    } else if (tk.type === "code") {
      const code = document.createElement("code");
      code.textContent = tk.value;
      parent.appendChild(code);
    } else if (tk.type === "bold") {
      const strong = document.createElement("strong");
      appendInline(strong, tk.value);
      parent.appendChild(strong);
    } else if (tk.type === "italic") {
      const em = document.createElement("em");
      appendInline(em, tk.value);
      parent.appendChild(em);
    } else if (tk.type === "link") {
      if (isSafeUrl(tk.href)) {
        const a = document.createElement("a");
        a.href = tk.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = tk.text;
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(`${tk.text} (${tk.href})`));
      }
    }
  }
}

function tokenizeInline(text) {
  const tokens = [];
  let remaining = text;
  // patterns in priority order
  const patterns = [
    { type: "code", re: /`([^`\n]+)`/ },
    { type: "link", re: /\[([^\]]+)\]\(([^\s)]+)\)/ },
    { type: "bold", re: /\*\*([^*]+)\*\*/ },
    { type: "italic", re: /(?:\*([^*\n]+)\*|_([^_\n]+)_)/ },
  ];

  while (remaining.length) {
    let earliest = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && (earliest === null || m.index < earliest.match.index)) {
        earliest = { pattern: p, match: m };
      }
    }
    if (!earliest) {
      tokens.push({ type: "text", value: remaining });
      break;
    }
    if (earliest.match.index > 0) {
      tokens.push({ type: "text", value: remaining.slice(0, earliest.match.index) });
    }
    const m = earliest.match;
    if (earliest.pattern.type === "link") {
      tokens.push({ type: "link", text: m[1], href: m[2] });
    } else if (earliest.pattern.type === "italic") {
      tokens.push({ type: "italic", value: m[1] || m[2] });
    } else {
      tokens.push({ type: earliest.pattern.type, value: m[1] });
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return tokens;
}

function isSafeUrl(href) {
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

/* Estimate token count from text (heuristic) */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
