/* Conversation exporter — Markdown and HTML generation.
   Pure functions, no network calls. Only triggerDownload has DOM side-effects. */

/**
 * Sanitize a conversation title into a safe filename fragment.
 * Lowercase, remove accents, replace invalid chars, collapse hyphens,
 * trim leading/trailing hyphens, limit to 80 chars, fallback "conversa".
 */
export function sanitizeTitle(title) {
  if (!title || typeof title !== "string") return "conversa";
  let s = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "conversa";
}

/**
 * Build a filename from sanitized title, date and extension.
 */
export function buildFilename(sanitized, date = new Date(), ext = "md") {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${sanitized}-${y}-${m}-${d}.${ext}`;
}

/**
 * Extract text content from a message, handling both string and multimodal array.
 * Replaces image parts with [imagem]. Omits reasoning field.
 */
function extractContent(message) {
  if (!message) return "";
  const c = message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((part) => {
      if (part.type === "text") return part.text || "";
      if (part.type === "image_url") return "[imagem]";
      return "";
    }).join("\n");
  }
  return "";
}

/**
 * Format a timestamp as DD/MM/YYYY.
 */
function formatDate(ts) {
  if (!ts) return "(data desconhecida)";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "(data desconhecida)";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Generate Markdown content for a conversation.
 */
export function generateMarkdown(conv) {
  const lines = [];
  lines.push(`# ${conv.title || "(sem título)"}`);
  lines.push("");
  lines.push(`> **Data**: ${formatDate(conv.createdAt)}`);
  lines.push(`> **Modelo**: ${conv.model || "(não especificado)"}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const messages = conv.messages || [];
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## Você");
    } else if (msg.role === "assistant") {
      lines.push("## Assistente");
    } else {
      continue;
    }
    lines.push("");
    lines.push(extractContent(msg));
    lines.push("");
  }

  return lines.join("\n");
}

/* ---------- HTML generation ---------- */

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Minimal Markdown→HTML converter via regex (no DOM, no deps).
 */
function renderMarkdownToHtml(md) {
  if (!md) return "";
  let html = escapeHtml(md);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code}</code></pre>`
  );

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  // collapse consecutive ul
  html = html.replace(/<\/ul>\s*<ul>/g, "");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs — wrap remaining lines
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>\s*<(h[1-3]|pre|ul|ol|li)/g, "<$1");
  html = html.replace(/<\/(h[1-3]|pre|ul|ol|li)>\s*<\/p>/g, "</$1>");
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

/**
 * Generate a self-contained HTML file for a conversation.
 */
export function generateHtml(conv) {
  const title = escapeHtml(conv.title || "(sem título)");
  const dateStr = formatDate(conv.createdAt);
  const model = escapeHtml(conv.model || "(não especificado)");
  const messages = conv.messages || [];

  let messagesHtml = "";
  if (!messages.length) {
    messagesHtml = `<p class="empty-state">Nenhuma mensagem nesta conversa.</p>`;
  } else {
    for (const msg of messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const roleClass = msg.role === "user" ? "msg-user" : "msg-assistant";
      const roleLabel = msg.role === "user" ? "Você" : "Assistente";
      const content = renderMarkdownToHtml(extractContent(msg));
      messagesHtml += `
      <div class="msg ${roleClass}">
        <div class="msg-role">${roleLabel}</div>
        <div class="msg-body">${content}</div>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root { --bg: #1a1b26; --fg: #c0caf5; --fg2: #9aa5ce; --accent: #7aa2f7; --line: #292e42; --user-bg: #1e2030; --assistant-bg: #16161e; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 900px; margin: 0 auto; }
    .header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
    .header h1 { font-size: 1.5rem; color: var(--accent); margin-bottom: 0.5rem; }
    .header .meta { font-size: 0.875rem; color: var(--fg2); }
    .msg { padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1rem; }
    .msg-user { background: var(--user-bg); }
    .msg-assistant { background: var(--assistant-bg); border-left: 3px solid var(--accent); }
    .msg-role { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 0.5rem; }
    .msg-body { white-space: pre-wrap; word-wrap: break-word; }
    .msg-body pre { background: #13131a; padding: 0.75rem; border-radius: 6px; overflow-x: auto; margin: 0.5rem 0; }
    .msg-body code { font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.9em; }
    .msg-body h1, .msg-body h2, .msg-body h3 { margin: 0.75rem 0 0.25rem; color: var(--accent); }
    .msg-body ul, .msg-body ol { padding-left: 1.5rem; margin: 0.5rem 0; }
    .msg-body strong { color: #fff; }
    .empty-state { text-align: center; padding: 3rem 1rem; color: var(--fg2); font-style: italic; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); text-align: center; font-size: 0.75rem; color: var(--fg2); }
    @media (prefers-color-scheme: light) {
      :root { --bg: #f8f9fa; --fg: #1a1b26; --fg2: #6b7280; --accent: #2563eb; --line: #e5e7eb; --user-bg: #f0f4ff; --assistant-bg: #ffffff; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${title}</h1>
    <div class="meta">Data: ${dateStr} · Modelo: ${model}</div>
  </div>
  ${messagesHtml}
  <div class="footer">
    <p>Gerado pelo Offline AI Chat</p>
  </div>
</body>
</html>`;
}

/**
 * Trigger a file download in the browser.
 */
export function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/**
 * Export a conversation in the given format. Never throws.
 */
export function exportConversation(conv, format, toastFn) {
  try {
    const sanitized = sanitizeTitle(conv.title);
    const filename = buildFilename(sanitized, new Date(), format === "html" ? "html" : "md");
    const content = format === "html" ? generateHtml(conv) : generateMarkdown(conv);
    const mime = format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";
    triggerDownload(content, filename, mime);
    if (toastFn) toastFn(`Exportado: ${filename}`, "success");
  } catch (err) {
    if (toastFn) toastFn(`Erro ao exportar: ${err.message}`, "error");
  }
}
