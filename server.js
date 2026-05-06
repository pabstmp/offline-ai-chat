/* Offline AI Chat — server.js
   - Static file server with ETag + Cache-Control + 304 support
   - Proxy to LM Studio (/api/models, /api/chat/completions)
   - Workspace filesystem endpoints (/api/fs/list, /api/fs/read, /api/fs/search)
     gated by WORKSPACE_ROOTS env (comma-separated whitelist) */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const MAX_PDF_BYTES = readPositiveIntEnv("MAX_PDF_BYTES", 1024 * 1024 * 32); // 32 MB
const MAX_BODY_BYTES = readPositiveIntEnv(
  "MAX_BODY_BYTES",
  Math.max(1024 * 1024 * 8, Math.ceil(MAX_PDF_BYTES * 1.4))
);
const MAX_FILE_BYTES = readPositiveIntEnv("MAX_FILE_BYTES", 256 * 1024);
const MAX_LIST_ENTRIES = 1000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 60;
const LAN_BIND = isNetworkExposedHost(HOST);
const ALLOW_UNRESTRICTED_WORKSPACE = readBoolEnv("ALLOW_UNRESTRICTED_WORKSPACE", !LAN_BIND);
const APP_AUTH_USER = process.env.APP_AUTH_USER || "offline-ai";
const APP_AUTH_PASSWORD = process.env.APP_AUTH_PASSWORD || process.env.APP_AUTH_TOKEN || "";
const AUTH_ENABLED = APP_AUTH_PASSWORD.length > 0;
const ALLOWED_LM_HOSTS = parseCsvEnv("ALLOWED_LM_HOSTS").map((s) => s.toLowerCase());

const WORKSPACE_ROOTS = parseCsvEnv("WORKSPACE_ROOTS");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".swift", ".dart",
  ".c", ".h", ".cpp", ".hpp", ".cs",
  ".html", ".htm", ".xml", ".css", ".scss", ".sass", ".less",
  ".json", ".yml", ".yaml", ".toml", ".ini", ".env", ".cfg", ".conf",
  ".md", ".mdx", ".rst", ".txt", ".log",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".graphql", ".gql", ".proto",
  ".vue", ".svelte", ".astro",
  ".dockerfile", ".gitignore", ".gitattributes",
  ".lock", ".tf",
]);

const NEVER_CACHE_PATHS = new Set([
  "/index.html",
  "/",
  "/sw.js",
]);

const STATIC_ALLOW_FILES = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/sw.js",
  "/manifest.webmanifest",
]);

const STATIC_ASSET_EXTENSIONS = new Set([
  ".gif", ".ico", ".jpg", ".jpeg", ".png", ".svg", ".webp",
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

/* ---------- helpers ---------- */

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return fallback;
}

function parseCsvEnv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNetworkExposedHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(h);
}

function withSecurityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, withSecurityHeaders({
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  }));
  response.end(body);
}

function sendUnauthorized(response) {
  const body = "Authentication required";
  response.writeHead(401, withSecurityHeaders({
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="Offline AI Chat", charset="UTF-8"',
  }));
  response.end(body);
}

function timingSafeStringEqual(a, b) {
  const ah = crypto.createHash("sha256").update(String(a)).digest();
  const bh = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function isAuthenticated(request) {
  if (!AUTH_ENABLED) return true;
  const raw = request.headers.authorization || "";
  if (!raw.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(raw.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return false;
    const user = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    return (
      timingSafeStringEqual(user, APP_AUTH_USER) &&
      timingSafeStringEqual(password, APP_AUTH_PASSWORD)
    );
  } catch {
    return false;
  }
}

function isSameOriginRequestAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = String(request.headers["x-forwarded-host"] || request.headers.host || "")
      .split(",")[0]
      .trim();
    return !!host && originUrl.host === host;
  } catch {
    return false;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body muito grande."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("JSON inválido.")); }
    });
    request.on("error", reject);
  });
}

function normalizeBaseUrl(value) {
  if (!value || typeof value !== "string") throw new Error("baseUrl ausente.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl deve usar http ou https.");
  }
  if (!isAllowedProxyTarget(url)) {
    throw new Error("baseUrl nao autorizado. Configure ALLOWED_LM_HOSTS para liberar este host.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url;
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^127\./.test(h);
}

function isAllowedProxyTarget(url) {
  if (ALLOWED_LM_HOSTS.length) {
    const hostname = url.hostname.toLowerCase();
    const host = url.host.toLowerCase();
    return ALLOWED_LM_HOSTS.some((allowed) => allowed === hostname || allowed === host);
  }
  if (LAN_BIND) return isLoopbackHostname(url.hostname);
  return true;
}

/* ---------- proxy to LM Studio ---------- */

/* Like proxyRequest but bypasses the /v1 path — used for LM Studio's
   extended API endpoints (/api/v0/*, /api/v1/models/load) which don't
   live under /v1/. We strip /v1 from the baseUrl and use absolutePath. */
function proxyRequestRaw({ apiKey, baseUrl, body, method, response, absolutePath }) {
  const base = normalizeBaseUrl(baseUrl);
  // Replace the /v1 path with the absolutePath
  const target = new URL(absolutePath, `${base.protocol}//${base.host}`);
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const client = target.protocol === "https:" ? https : http;

  const headers = { Accept: "application/json" };
  if (payload) {
    headers["Content-Length"] = payload.length;
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const upstream = client.request(target, { headers, method }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, withSecurityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": upstreamResponse.headers["content-type"] || "application/json; charset=utf-8",
    }));
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    if (!response.headersSent) sendJson(response, 502, { error: { message: error.message } });
    else response.end();
  });

  if (payload) upstream.write(payload);
  upstream.end();
}

function proxyRequest({ apiKey, baseUrl, body, method, response, upstreamPath }) {
  const base = normalizeBaseUrl(baseUrl);
  const target = new URL(`${base.pathname}${upstreamPath}`, base);
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const client = target.protocol === "https:" ? https : http;
  const startedAt = Date.now();
  // Compact context for logs — model id + input count for embeddings, model id
  // for chat completions. Shows on every request and helps correlate with
  // LM Studio's own logs.
  const ctx = body
    ? `model=${body.model || "?"}${Array.isArray(body.input) ? ` inputs=${body.input.length}` : ""}${body.messages ? ` msgs=${body.messages.length}` : ""}`
    : "";

  const headers = { Accept: "application/json, text/event-stream" };
  if (payload) {
    headers["Content-Length"] = payload.length;
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const upstream = client.request(target, { headers, method }, (upstreamResponse) => {
    const elapsed = Date.now() - startedAt;
    const status = upstreamResponse.statusCode || 502;
    if (status >= 400) {
      // Capture body so the error doesn't disappear into the void.
      const chunks = [];
      upstreamResponse.on("data", (c) => chunks.push(c));
      upstreamResponse.on("end", () => {
        const bodyStr = Buffer.concat(chunks).toString("utf8").slice(0, 1000);
        console.warn(`[proxy] ${method} ${target.pathname} ${status} ${elapsed}ms ${ctx} :: ${bodyStr}`);
        response.writeHead(status, withSecurityHeaders({
          "Cache-Control": "no-store",
          "Content-Type": upstreamResponse.headers["content-type"] || "application/json; charset=utf-8",
        }));
        response.end(bodyStr);
      });
      return;
    }
    console.log(`[proxy] ${method} ${target.pathname} ${status} ${elapsed}ms ${ctx}`);
    response.writeHead(status, withSecurityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": upstreamResponse.headers["content-type"] || "application/json; charset=utf-8",
    }));
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    const elapsed = Date.now() - startedAt;
    console.error(`[proxy] ${method} ${target.pathname} CONNECTION-FAIL ${elapsed}ms ${ctx} :: ${error.message}`);
    if (!response.headersSent) {
      sendJson(response, 502, { error: { message: error.message } });
      return;
    }
    response.end();
  });

  if (payload) upstream.write(payload);
  upstream.end();
}

async function handleApi(request, response, pathname) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: { message: "Método não permitido." } });
    return;
  }
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    sendJson(response, 415, { error: { message: "Content-Type deve ser application/json." } });
    return;
  }

  try {
    const body = await readBody(request);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    const baseUrl = body.baseUrl;

    if (pathname === "/api/models") {
      proxyRequest({ apiKey, baseUrl, method: "GET", response, upstreamPath: "/models" });
      return;
    }
    if (pathname === "/api/chat/completions") {
      proxyRequest({
        apiKey, baseUrl,
        body: body.payload,
        method: "POST",
        response,
        upstreamPath: "/chat/completions",
      });
      return;
    }
    if (pathname === "/api/embeddings") {
      proxyRequest({
        apiKey, baseUrl,
        body: body.payload,
        method: "POST",
        response,
        upstreamPath: "/embeddings",
      });
      return;
    }
    if (pathname === "/api/lm/models-info") {
      // LM Studio extended API — list with state + max_ctx + loaded_ctx + arch
      proxyRequestRaw({
        apiKey, baseUrl,
        method: "GET",
        response,
        absolutePath: "/api/v0/models",
      });
      return;
    }
    if (pathname === "/api/lm/load-model") {
      // LM Studio extended API — load model with custom context_length
      proxyRequestRaw({
        apiKey, baseUrl,
        body: body.payload,
        method: "POST",
        response,
        absolutePath: "/api/v1/models/load",
      });
      return;
    }
    if (pathname === "/api/lm/unload-model") {
      proxyRequestRaw({
        apiKey, baseUrl,
        body: body.payload,
        method: "POST",
        response,
        absolutePath: "/api/v1/models/unload",
      });
      return;
    }
    if (pathname === "/api/fs/list") return handleFsList(body, response, request);
    if (pathname === "/api/fs/read") return handleFsRead(body, response, request);
    if (pathname === "/api/fs/read-pdf") return handleFsReadPdf(body, response, request);
    if (pathname === "/api/fs/search") return handleFsSearch(body, response, request);
    if (pathname === "/api/extract-pdf") return handleExtractPdf(body, response);

    sendJson(response, 404, { error: { message: "Endpoint local não encontrado." } });
  } catch (error) {
    sendJson(response, 400, { error: { message: error.message } });
  }
}

/* ---------- workspace fs ---------- */

const rateBuckets = new Map(); // ip -> { count, resetAt }

function rateLimited(request) {
  const ip = (request.socket.remoteAddress || "unknown").toString();
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT_MAX;
}

/* Translate Windows-style paths (C:\foo\bar) to container-mounted paths
   when running on Linux. Tries /host/c/foo/bar (docker-compose default),
   then /mnt/c/foo/bar (WSL native style). Returns the original path if
   no mount is found, so the caller can produce a clean error. */
function translateWindowsPath(p) {
  if (process.platform === "win32") return p;
  const m = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) return p;
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, "/");
  const candidates = [
    `/host/${drive}/${rest}`,
    `/mnt/${drive}/${rest}`,
  ];
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) return cand;
    } catch {}
  }
  return p;
}

let allowedWorkspaceRootsCache = null;

function realpathIfExists(p) {
  try { return fs.realpathSync.native(p); }
  catch { return null; }
}

function getAllowedWorkspaceRoots() {
  if (allowedWorkspaceRootsCache) return allowedWorkspaceRootsCache;
  allowedWorkspaceRootsCache = WORKSPACE_ROOTS.map((raw) => {
    const translated = translateWindowsPath(raw);
    const resolved = path.resolve(translated);
    return realpathIfExists(resolved) || resolved;
  });
  return allowedWorkspaceRootsCache;
}

function isInsideRoot(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function resolveSafePath(sourceRoot, relPath) {
  if (typeof sourceRoot !== "string" || typeof relPath !== "string") {
    throw new Error("sourceRoot e relPath são obrigatórios.");
  }
  // Auto-translate Windows paths when running in Linux container
  const translated = translateWindowsPath(sourceRoot);
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(sourceRoot);
  const root = path.resolve(translated);
  const realRoot = realpathIfExists(root) || root;

  if (!WORKSPACE_ROOTS.length && !ALLOW_UNRESTRICTED_WORKSPACE) {
    throw new Error("WORKSPACE_ROOTS e obrigatorio quando o servidor esta exposto em LAN.");
  }

  const allowedRoots = getAllowedWorkspaceRoots();
  if (allowedRoots.length && !allowedRoots.some((r) => isInsideRoot(realRoot, r))) {
    throw new Error("sourceRoot não está autorizado em WORKSPACE_ROOTS.");
  }

  // If path looks Windows but translation didn't find it on Linux, give a helpful error
  if (isWindowsPath && process.platform !== "win32" && !fs.existsSync(root)) {
    throw new Error(
      `Path "${sourceRoot}" não está acessível pelo servidor. ` +
      `Se você está rodando em Docker, garanta que o disco está montado: ` +
      `o docker-compose.yml precisa ter bind mount tipo "/mnt/c:/host/c:ro" no Windows ` +
      `(no Docker Desktop Windows com WSL2, isso já vem por padrão). ` +
      `Alternativa: rode 'node server.js' direto no PowerShell pra acesso nativo ao Windows.`
    );
  }

  const normalizedRel = path.normalize(relPath).replace(/^([\\/])+/, "");
  if (normalizedRel.startsWith("..") || path.isAbsolute(normalizedRel)) {
    throw new Error("relPath inválido.");
  }
  const absolute = path.resolve(root, normalizedRel);
  if (!isInsideRoot(absolute, root)) {
    throw new Error("Acesso fora do sourceRoot bloqueado.");
  }
  const realAbsolute = realpathIfExists(absolute);
  if (realAbsolute && !isInsideRoot(realAbsolute, realRoot)) {
    throw new Error("Acesso por symlink fora do sourceRoot bloqueado.");
  }
  return { root: realRoot, absolute: realAbsolute || absolute };
}

async function isProbablyBinary(absolute) {
  const ext = path.extname(absolute).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return false;
  try {
    const fd = await fsp.open(absolute, "r");
    try {
      const buf = Buffer.alloc(512);
      const { bytesRead } = await fd.read(buf, 0, 512, 0);
      for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
      return false;
    } finally {
      await fd.close();
    }
  } catch {
    return true;
  }
}

async function handleFsList(body, response, request) {
  if (rateLimited(request)) {
    sendJson(response, 429, { error: { message: "Muitas requisições, aguarde." } });
    return;
  }
  try {
    const { absolute } = resolveSafePath(body.sourceRoot, body.relPath || "");
    const stat = await fsp.stat(absolute);
    if (!stat.isDirectory()) {
      sendJson(response, 400, { error: { message: "relPath não é um diretório." } });
      return;
    }
    const dirents = await fsp.readdir(absolute, { withFileTypes: true });
    const entries = dirents.slice(0, MAX_LIST_ENTRIES).map((d) => ({
      name: d.name,
      kind: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
    }));
    sendJson(response, 200, { entries });
  } catch (error) {
    sendJson(response, 403, { error: { message: error.message } });
  }
}

async function handleFsRead(body, response, request) {
  if (rateLimited(request)) {
    sendJson(response, 429, { error: { message: "Muitas requisições, aguarde." } });
    return;
  }
  try {
    const { absolute } = resolveSafePath(body.sourceRoot, body.relPath);
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) {
      sendJson(response, 400, { error: { message: "relPath não é um arquivo." } });
      return;
    }
    if (stat.size > MAX_FILE_BYTES) {
      sendJson(response, 413, { error: { message: `Arquivo maior que ${MAX_FILE_BYTES} bytes.` } });
      return;
    }
    if (await isProbablyBinary(absolute)) {
      sendJson(response, 415, { error: { message: "Arquivo binário não suportado." } });
      return;
    }
    const content = await fsp.readFile(absolute, "utf8");
    sendJson(response, 200, {
      content,
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  } catch (error) {
    sendJson(response, 403, { error: { message: error.message } });
  }
}

async function handleFsSearch(body, response, request) {
  if (rateLimited(request)) {
    sendJson(response, 429, { error: { message: "Muitas requisições, aguarde." } });
    return;
  }
  try {
    const { root, absolute } = resolveSafePath(body.sourceRoot, body.relPath || "");
    const query = String(body.query || "").trim();
    const limit = Math.min(Number(body.limit) || 100, 500);
    if (!query) {
      sendJson(response, 400, { error: { message: "query vazia." } });
      return;
    }
    const matches = [];
    const ignore = ["node_modules", ".git", "dist", "build", ".next", ".cache"];

    async function walk(dir) {
      if (matches.length >= limit) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (matches.length >= limit) return;
        if (ignore.includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!TEXT_EXTENSIONS.has(ext)) continue;
          try {
            const stat = await fsp.stat(full);
            if (stat.size > MAX_FILE_BYTES) continue;
            const content = await fsp.readFile(full, "utf8");
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                matches.push({
                  path: path.relative(root, full).split(path.sep).join("/"),
                  line: i + 1,
                  snippet: lines[i].slice(0, 240),
                });
                if (matches.length >= limit) break;
              }
            }
          } catch { /* skip unreadable */ }
        }
      }
    }
    await walk(absolute);
    sendJson(response, 200, { matches });
  } catch (error) {
    sendJson(response, 403, { error: { message: error.message } });
  }
}

/* Read a PDF directly from disk + extract text. Used by RAG indexer
   to avoid the client having to fetch + base64-encode every PDF. */
async function handleFsReadPdf(body, response, request) {
  if (rateLimited(request)) {
    sendJson(response, 429, { error: { message: "Muitas requisições, aguarde." } });
    return;
  }
  try {
    const { absolute } = resolveSafePath(body.sourceRoot, body.relPath);
    const ext = path.extname(absolute).toLowerCase();
    if (ext !== ".pdf") {
      sendJson(response, 400, { error: { message: "Não é um arquivo PDF." } });
      return;
    }
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) {
      sendJson(response, 400, { error: { message: "relPath não é um arquivo." } });
      return;
    }
    if (stat.size > MAX_PDF_BYTES) {
      sendJson(response, 413, { error: { message: `PDF excede ${MAX_PDF_BYTES} bytes.` } });
      return;
    }
    const buf = await fsp.readFile(absolute);
    if (buf.length < 5 || buf.slice(0, 5).toString() !== "%PDF-") {
      sendJson(response, 415, { error: { message: "Arquivo não é um PDF válido." } });
      return;
    }
    const pdfjs = await getPdfJs();
    const data = new Uint8Array(buf);
    const useOcr = !!body.ocr;
    const docOpts = {
      data, useWorkerFetch: false, disableFontFace: true, isEvalSupported: false, verbosity: 0,
    };
    if (useOcr) {
      const canvasLib = await getCanvasLib();
      docOpts.canvasFactory = new NodeCanvasFactory(canvasLib);
    }
    const loadingTask = pdfjs.getDocument(docOpts);
    const doc = await loadingTask.promise;
    const numPages = doc.numPages;
    const maxPages = Math.min(numPages, 500);
    const pages = [];
    let pagesEmpty = 0;
    let pagesOcred = 0;
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let text = extractLayoutAwareText(tc);
      const hadTextLayer = text.trim().length >= 10;
      if (!hadTextLayer && useOcr) {
        const ocrText = await ocrPage(page, OCR_LANGS);
        if (ocrText.length >= 10) {
          text = ocrText;
          pagesOcred++;
        }
      }
      if (text.trim().length < 10) pagesEmpty++;
      pages.push({ page: i, text });
      page.cleanup?.();
    }
    await doc.cleanup?.();
    await doc.destroy?.();
    const fullText = pages.map((p) => `--- página ${p.page} ---\n${p.text}`).join("\n\n");
    const pagesWithText = maxPages - pagesEmpty;
    // Heuristic: PDF likely needs OCR when more than half the pages have no
    // extractable text layer (typical for scanned documents).
    const ocrLikelyNeeded = !useOcr && pagesEmpty > 0 && pagesEmpty / maxPages > 0.5;
    sendJson(response, 200, {
      content: fullText,
      pageCount: numPages,
      extractedPages: maxPages,
      pagesWithText,
      pagesEmpty,
      pagesOcred,
      ocrApplied: useOcr,
      ocrLikelyNeeded,
      truncated: numPages > maxPages,
      size: stat.size,
    });
  } catch (error) {
    sendJson(response, 500, { error: { message: `PDF read: ${error.message}` } });
  }
}

/* ---------- PDF extraction (pdfjs-dist) ---------- */

let pdfjsLib = null;
async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  // Use legacy build for Node compatibility
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsLib;
}

/* ---------- OCR pipeline (tesseract.js + @napi-rs/canvas) ----------
   Loaded lazily so the server starts fast and OCR-less deployments
   don't pay the cost. tesseract.js downloads traineddata files from a
   CDN on first use and caches them to disk; bundle them locally if
   you need a fully offline first-run. */

let napiCanvas = null;
async function getCanvasLib() {
  if (napiCanvas) return napiCanvas;
  napiCanvas = await import("@napi-rs/canvas");
  return napiCanvas;
}

let tesseractWorker = null;
let tesseractWorkerLangs = null;
async function getTesseractWorker(langs) {
  const langKey = langs.join("+");
  if (tesseractWorker && tesseractWorkerLangs === langKey) return tesseractWorker;
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch {}
    tesseractWorker = null;
  }
  const tess = await import("tesseract.js");
  const cachePath = process.env.OCR_CACHE_DIR || path.join("/tmp", "tesseract-cache");
  try { await fsp.mkdir(cachePath, { recursive: true }); } catch {}
  tesseractWorker = await tess.createWorker(langs, 1, {
    cachePath,
    cacheMethod: "readWrite",
    logger: () => {},
  });
  tesseractWorkerLangs = langKey;
  return tesseractWorker;
}

class NodeCanvasFactory {
  constructor(canvasLib) { this.canvasLib = canvasLib; }
  create(width, height) {
    const canvas = this.canvasLib.createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/* Render a pdfjs page to a PNG buffer and run OCR on it. Returns the
   recognized text or "" on failure. Scale 2 trades render time for
   recognition accuracy on small fonts. */
async function ocrPage(page, langs) {
  try {
    const canvasLib = await getCanvasLib();
    const factory = new NodeCanvasFactory(canvasLib);
    const viewport = page.getViewport({ scale: 2.0 });
    const ctxPair = factory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: ctxPair.context,
      viewport,
      canvasFactory: factory,
    }).promise;
    const pngBuffer = ctxPair.canvas.toBuffer("image/png");
    factory.destroy(ctxPair);
    const worker = await getTesseractWorker(langs);
    const { data } = await worker.recognize(pngBuffer);
    return (data?.text || "").trim();
  } catch (err) {
    console.warn(`OCR failed: ${err.message}`);
    return "";
  }
}

const OCR_LANGS = (process.env.OCR_LANGS || "por+eng").split("+").map((s) => s.trim()).filter(Boolean);

/* Extract layout-aware text from a pdfjs textContent object.
   Groups items by Y position (lines), sorts by X within line, and
   inserts tabs when there's a horizontal gap. Preserves table-ish
   structure that disappears with naive join(" "). */
function extractLayoutAwareText(textContent) {
  if (!textContent?.items?.length) return "";
  const items = textContent.items.filter((it) => "str" in it && it.str);
  if (!items.length) return "";

  // Each item has: { str, transform: [a,b,c,d, x, y], width, height }
  // y is bottom-to-top in PDF coords (higher y = higher on page)

  // 1) Group by approximate Y (within tolerance)
  const Y_TOLERANCE = 3;
  const sorted = [...items].sort((a, b) => {
    const ay = a.transform[5];
    const by = b.transform[5];
    if (Math.abs(ay - by) < Y_TOLERANCE) return a.transform[4] - b.transform[4];
    return by - ay; // top-to-bottom
  });

  const lines = [];
  let currentLine = [];
  let lastY = null;
  for (const it of sorted) {
    const y = it.transform[5];
    if (lastY === null || Math.abs(y - lastY) < Y_TOLERANCE) {
      currentLine.push(it);
    } else {
      if (currentLine.length) lines.push(currentLine);
      currentLine = [it];
    }
    lastY = y;
  }
  if (currentLine.length) lines.push(currentLine);

  // 2) Build text per line, inserting tab/space based on horizontal gap
  const HORIZONTAL_GAP_FOR_TAB = 12; // pt
  const out = [];
  for (const line of lines) {
    line.sort((a, b) => a.transform[4] - b.transform[4]);
    let s = "";
    let lastEnd = null;
    for (const it of line) {
      const x = it.transform[4];
      const w = it.width || 0;
      if (lastEnd !== null) {
        const gap = x - lastEnd;
        if (gap > HORIZONTAL_GAP_FOR_TAB) {
          s += "\t";
        } else if (gap > 0.5 && !/\s$/.test(s) && !/^\s/.test(it.str)) {
          s += " ";
        }
      }
      s += it.str;
      lastEnd = x + w;
    }
    out.push(s.trimEnd());
  }
  return out.join("\n");
}

async function handleExtractPdf(body, response) {
  try {
    if (!body.dataBase64 || typeof body.dataBase64 !== "string") {
      sendJson(response, 400, { error: { message: "dataBase64 ausente." } });
      return;
    }
    const buf = Buffer.from(body.dataBase64, "base64");
    if (buf.length > MAX_PDF_BYTES) {
      sendJson(response, 413, { error: { message: `PDF excede ${MAX_PDF_BYTES} bytes.` } });
      return;
    }
    if (buf.length < 5 || buf.slice(0, 5).toString() !== "%PDF-") {
      sendJson(response, 415, { error: { message: "Arquivo não é um PDF válido." } });
      return;
    }

    const pdfjs = await getPdfJs();
    // pdfjs needs Uint8Array
    const data = new Uint8Array(buf);
    const useOcr = !!body.ocr;
    const docOpts = {
      data,
      useWorkerFetch: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    };
    if (useOcr) {
      const canvasLib = await getCanvasLib();
      docOpts.canvasFactory = new NodeCanvasFactory(canvasLib);
    }
    const loadingTask = pdfjs.getDocument(docOpts);
    const doc = await loadingTask.promise;

    const pages = [];
    const numPages = doc.numPages;
    const maxPages = Math.min(numPages, 500); // safety cap
    let pagesEmpty = 0;
    let pagesOcred = 0;

    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let text = extractLayoutAwareText(tc);
      const hadTextLayer = text.trim().length >= 10;
      if (!hadTextLayer && useOcr) {
        const ocrText = await ocrPage(page, OCR_LANGS);
        if (ocrText.length >= 10) {
          text = ocrText;
          pagesOcred++;
        }
      }
      if (text.trim().length < 10) pagesEmpty++;
      pages.push({ page: i, text });
      page.cleanup?.();
    }
    await doc.cleanup?.();
    await doc.destroy?.();

    const fullText = pages.map((p) => `--- página ${p.page} ---\n${p.text}`).join("\n\n");
    const pagesWithText = maxPages - pagesEmpty;
    const ocrLikelyNeeded = !useOcr && pagesEmpty > 0 && pagesEmpty / maxPages > 0.5;
    sendJson(response, 200, {
      content: fullText,
      pageCount: numPages,
      extractedPages: maxPages,
      pagesWithText,
      pagesEmpty,
      pagesOcred,
      ocrApplied: useOcr,
      ocrLikelyNeeded,
      truncated: numPages > maxPages,
      size: buf.length,
    });
  } catch (error) {
    sendJson(response, 500, { error: { message: `PDF extract: ${error.message}` } });
  }
}

/* ---------- static with ETag + Cache-Control ---------- */

function makeEtag(stat) {
  return `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
}

function cacheControlFor(pathname) {
  if (NEVER_CACHE_PATHS.has(pathname)) return "no-cache";
  if (pathname.endsWith(".webmanifest")) return "no-cache";
  if (pathname.endsWith(".js") || pathname.endsWith(".css")) return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}

function isStaticPathAllowed(pathname) {
  if (!pathname || pathname.includes("\0") || pathname.includes("\\")) return false;
  if (STATIC_ALLOW_FILES.has(pathname)) return true;
  const ext = path.extname(pathname).toLowerCase();
  if (pathname.startsWith("/modules/")) return ext === ".js";
  if (pathname.startsWith("/assets/")) return STATIC_ASSET_EXTENSIONS.has(ext);
  return false;
}

function hasHiddenPathSegment(relativePath) {
  return relativePath.split(/[\\/]+/).some((part) => part.startsWith("."));
}

function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: { message: "Método não permitido." } });
    return;
  }
  if (!isStaticPathAllowed(pathname)) {
    sendJson(response, 404, { error: { message: "Arquivo não encontrado." } });
    return;
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(ROOT, relativePath);
  const rootRelative = path.relative(ROOT, filePath);

  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative) || hasHiddenPathSegment(rootRelative)) {
    sendJson(response, 403, { error: { message: "Acesso negado." } });
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(response, 404, { error: { message: "Arquivo não encontrado." } });
      return;
    }

    const etag = makeEtag(stat);
    const ifNoneMatch = request.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      response.writeHead(304, withSecurityHeaders({ ETag: etag, "Cache-Control": cacheControlFor(pathname) }));
      response.end();
      return;
    }

    response.writeHead(200, withSecurityHeaders({
      "Cache-Control": cacheControlFor(pathname),
      "Content-Length": stat.size,
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      ETag: etag,
    }));
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
}

/* ---------- server ---------- */

const server = http.createServer((request, response) => {
  let url;
  let pathname;
  try {
    url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: { message: "URL inválida." } });
    return;
  }

  if (!isAuthenticated(request)) {
    sendUnauthorized(response);
    return;
  }

  if (pathname.startsWith("/api/") && !isSameOriginRequestAllowed(request)) {
    sendJson(response, 403, { error: { message: "Origin não autorizado." } });
    return;
  }

  if (pathname.startsWith("/api/")) { handleApi(request, response, pathname); return; }
  serveStatic(request, response, pathname);
});

server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

function startServer() {
  server.listen(PORT, HOST, () => {
    const visibleHost = HOST === "0.0.0.0" ? "localhost" : HOST;
    console.log(`Offline AI Chat: http://${visibleHost}:${PORT}`);
    console.log(`Bind: ${HOST}:${PORT}${LAN_BIND ? " (LAN)" : " (local)"}`);
    console.log(`Auth: ${AUTH_ENABLED ? `Basic habilitado (usuario "${APP_AUTH_USER}")` : "desabilitado"}`);
    if (LAN_BIND && !AUTH_ENABLED) {
      console.warn("AVISO: servidor exposto em LAN sem APP_AUTH_PASSWORD/APP_AUTH_TOKEN.");
    }
    if (ALLOWED_LM_HOSTS.length) {
      console.log(`LM hosts permitidos: ${ALLOWED_LM_HOSTS.join(", ")}`);
    } else if (LAN_BIND) {
      console.log("LM hosts permitidos: apenas loopback (configure ALLOWED_LM_HOSTS para liberar outros).");
    } else {
      console.log("LM hosts permitidos: qualquer host (modo local).");
    }
    if (WORKSPACE_ROOTS.length) {
      console.log(`Workspace: whitelist ativa - ${WORKSPACE_ROOTS.join(", ")}`);
    } else if (ALLOW_UNRESTRICTED_WORKSPACE) {
      console.log("Workspace: modo local single-user (qualquer pasta conectada pela UI e aceita)");
    } else {
      console.log("Workspace: bloqueado ate configurar WORKSPACE_ROOTS (seguro para LAN)");
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer,
  normalizeBaseUrl,
  resolveSafePath,
  isAuthenticated,
  isSameOriginRequestAllowed,
  isStaticPathAllowed,
  isAllowedProxyTarget,
  config: {
    HOST,
    PORT,
    LAN_BIND,
    AUTH_ENABLED,
    APP_AUTH_USER,
    ALLOWED_LM_HOSTS,
    WORKSPACE_ROOTS,
    ALLOW_UNRESTRICTED_WORKSPACE,
    MAX_BODY_BYTES,
    MAX_FILE_BYTES,
    MAX_PDF_BYTES,
  },
};
