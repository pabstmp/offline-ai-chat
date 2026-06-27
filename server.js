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

const { createSafeWriter } = require("./server-lib/safe-write");
const { createLlmCaller } = require("./server-lib/llm");
const { createCronEngine } = require("./server-lib/cron-engine");

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

/* Web search: DDG (default, sem config) com opção de Brave API key.
   A chave do Brave pode vir do env (BRAVE_SEARCH_API_KEY) OU do localStorage
   do client via campo `apiKey` no body da request — o server prefere a do
   client. Mantém UX: zero-config funciona com DDG, e o usuário power-user
   cola a key em Settings → Avançado sem mexer em env vars. */
const BRAVE_SEARCH_API_KEY_ENV = (process.env.BRAVE_SEARCH_API_KEY || "").trim();

/* Cron / tarefas agendadas. Desligado por default (opt-in). A EXECUÇÃO só roda
   com CRON_ENABLED=true; o gerenciamento via UI funciona sempre (o engine só
   carrega/edita estado, sem disparar timers, quando desabilitado).
   FS_WRITE_ROOTS é uma whitelist SEPARADA de WORKSPACE_ROOTS — escrita só é
   permitida nessas raízes (nunca no mount :ro de leitura). */
const CRON_ENABLED = readBoolEnv("CRON_ENABLED", false);
const FS_WRITE_ROOTS = parseCsvEnv("FS_WRITE_ROOTS");
const CRON_STATE_DIR = process.env.CRON_STATE_DIR || path.join(ROOT, "data");
const CRON_SEED_FILE = (process.env.CRON_SEED_FILE || "").trim();
const CRON_TZ = (process.env.CRON_TZ || "UTC").trim();
const CRON_MAX_TIMEOUT_MS = readPositiveIntEnv("CRON_MAX_TIMEOUT_MS", 300_000);
const CRON_MAX_FAILURES = readPositiveIntEnv("CRON_MAX_FAILURES", 5);
const MAX_WRITE_BYTES = readPositiveIntEnv("MAX_WRITE_BYTES", 5 * 1024 * 1024);

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
    // index.html não tem <script> inline; app.js é o único entry point via <script type="module">.
    // O sandbox iframe usa srcdoc + sandbox sem allow-same-origin (origem opaca) —
    // não herda CSP do parent, portanto não exige 'unsafe-inline' aqui.
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-src 'self'",
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
  // OpenRouter: preset de nuvem suportado nativamente (host publico fixo, HTTPS) —
  // liberado mesmo com ALLOWED_LM_HOSTS restrito; nao amplia SSRF para hosts internos.
  if (isOpenRouterHost(url.hostname)) return true;
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
function isOpenRouterHost(hostname) {
  return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
}

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
  if (isOpenRouterHost(target.hostname)) {
    headers["HTTP-Referer"] = "https://offline-ai-chat.local";
    headers["X-Title"] = "Offline AI Chat";
  }

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
  if (isOpenRouterHost(target.hostname)) {
    headers["HTTP-Referer"] = "https://offline-ai-chat.local";
    headers["X-Title"] = "Offline AI Chat";
  }

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
    if (pathname === "/api/tools/web-search") {
      return handleToolsWebSearch(body, response, request);
    }
    if (pathname.startsWith("/api/cron/")) {
      return handleCronApi(request, response, pathname, body);
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

/* ---------- cron engine (tarefas agendadas) ---------- */

/* Camada de escrita segura: whitelist própria (FS_WRITE_ROOTS), reaproveitando
   a tradução de paths Windows→container e o realpath do server. */
const safeWriter = createSafeWriter({
  writeRoots: FS_WRITE_ROOTS,
  translateWindowsPath,
  realpathIfExists,
  maxWriteBytes: MAX_WRITE_BYTES,
});

/* Camada de LEITURA segura: usa a whitelist de WORKSPACE_ROOTS (mesma de /api/fs/read),
   SEPARADA do safeWriter (FS_WRITE_ROOTS). Reaproveita resolveSafePath + os guards de
   tamanho/binário. Usado pelo cron (ex.: passo de cascata que lê um arquivo local). */
const safeReader = {
  getReadRoots: () => getAllowedWorkspaceRoots(),
  async readSafeTextFile(sourceRoot, relPath) {
    const { absolute } = resolveSafePath(sourceRoot, relPath); // valida ../, absoluto, symlink
    const st = await fsp.stat(absolute);
    if (!st.isFile()) throw new Error("relPath não é um arquivo.");
    if (st.size > MAX_FILE_BYTES) throw new Error(`Arquivo maior que ${MAX_FILE_BYTES} bytes.`);
    if (await isProbablyBinary(absolute)) throw new Error("Arquivo binário não suportado.");
    return { content: await fsp.readFile(absolute, "utf8"), size: st.size };
  },
};

/* Caller LLM in-process (não-streaming). Reaproveita o guard SSRF do proxy
   (normalizeBaseUrl → isAllowedProxyTarget) como fonte única. */
const { callLLMOnce } = createLlmCaller({ normalizeBaseUrl, isOpenRouterHost });

const cron = createCronEngine({
  enabled: CRON_ENABLED,
  stateFilePath: path.join(CRON_STATE_DIR, "cron-state.json"),
  seedFilePath: CRON_SEED_FILE || null,
  defaultTz: CRON_TZ,
  maxTimeoutMs: CRON_MAX_TIMEOUT_MS,
  maxFailures: CRON_MAX_FAILURES,
  taskDeps: {
    callLLMOnce,
    webSearch: (query) => webSearchCore(query, ""), // usa Brave key do env (fallback DDG)
    safeWriter,
    safeReader,
  },
  log: console,
});

async function handleCronApi(request, response, pathname, body) {
  if (rateLimited(request)) {
    return sendJson(response, 429, { error: { message: "Muitas requisições, aguarde." } });
  }
  try {
    if (pathname === "/api/cron/list") {
      return sendJson(response, 200, cron.getPublicState());
    }
    if (pathname === "/api/cron/upsert") {
      return sendJson(response, 200, { task: cron.upsertTask(body.task || {}) });
    }
    if (pathname === "/api/cron/delete") {
      return sendJson(response, 200, cron.deleteTask(String(body.id || "")));
    }
    if (pathname === "/api/cron/run-now") {
      return sendJson(response, 200, cron.runNow(String(body.id || "")));
    }
    if (pathname === "/api/cron/history") {
      return sendJson(response, 200, { history: cron.getHistory(String(body.id || "")) });
    }
    if (pathname === "/api/cron/result") {
      const out = await cron.getResult(String(body.id || ""), body.runId || null);
      return sendJson(response, 200, out);
    }
    if (pathname === "/api/cron/connection-upsert") {
      const conn = body.connection || {};
      // Valida baseUrl pelo mesmo guard SSRF do proxy — rejeita host proibido
      // no momento do save (na UI), não às 3h da manhã.
      if (conn.baseUrl) normalizeBaseUrl(conn.baseUrl);
      return sendJson(response, 200, { connection: cron.upsertConnection(conn) });
    }
    if (pathname === "/api/cron/connection-delete") {
      return sendJson(response, 200, cron.deleteConnection(String(body.id || "")));
    }
    if (pathname === "/api/cron/agent-upsert") {
      // Agente referencia uma conexão (já validada por SSRF no upsert dela) — sem guard extra.
      return sendJson(response, 200, { agent: cron.upsertAgent(body.agent || {}) });
    }
    if (pathname === "/api/cron/agent-delete") {
      return sendJson(response, 200, cron.deleteAgent(String(body.id || "")));
    }
    return sendJson(response, 404, { error: { message: "Endpoint cron não encontrado." } });
  } catch (err) {
    return sendJson(response, 400, { error: { message: err.message } });
  }
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
      console.warn(
        "AVISO: ALLOWED_LM_HOSTS vazio em modo local — qualquer baseUrl recebido pelo " +
        "proxy /api/chat/completions sera aceito. Apps locais malignos (extensoes, processos) " +
        "podem usar este servidor como pivot SSRF. Configure ALLOWED_LM_HOSTS=localhost para restringir."
      );
    }
    if (WORKSPACE_ROOTS.length) {
      console.log(`Workspace: whitelist ativa - ${WORKSPACE_ROOTS.join(", ")}`);
    } else if (ALLOW_UNRESTRICTED_WORKSPACE) {
      console.log("Workspace: modo local single-user (qualquer pasta conectada pela UI e aceita)");
    } else {
      console.log("Workspace: bloqueado ate configurar WORKSPACE_ROOTS (seguro para LAN)");
    }
    const braveCfg = BRAVE_SEARCH_API_KEY_ENV
      ? "brave (via env) -> duckduckgo (fallback)"
      : "duckduckgo (default) — client pode enviar Brave key opcionalmente";
    console.log(`Web search: ${braveCfg}`);

    // Cron: sempre carrega estado (UI gerencia mesmo desabilitado);
    // o ticker só dispara quando CRON_ENABLED=true.
    cron.start().then(() => {
      const st = cron.getPublicState();
      console.log(
        `[cron] ${CRON_ENABLED ? "habilitado" : "desabilitado"} — ` +
        `state-dir=${CRON_STATE_DIR} write-roots=[${FS_WRITE_ROOTS.join(", ")}] tarefas=${st.tasks.length}`
      );
      if (CRON_ENABLED && !FS_WRITE_ROOTS.length) {
        console.warn("[cron] AVISO: CRON_ENABLED sem FS_WRITE_ROOTS — tarefas que escrevem (boletim/backup/rotação) vão falhar.");
      }
      if (CRON_ENABLED && LAN_BIND && !AUTH_ENABLED) {
        console.warn("[cron] AVISO: cron ativo em LAN sem auth — superfície de saída/escrita exposta. Configure APP_AUTH_PASSWORD.");
      }
    }).catch((err) => console.error(`[cron] start falhou: ${err.message}`));
  });
}

/**
 * Ferramenta de busca na web.
 *
 * Estratégia:
 *   1. Se houver Brave API key (do body do client OU do env) → tenta Brave.
 *      Brave tem JSON limpo, free tier 2000/mês, sem anti-bot. É o caminho
 *      "user-friendly mais confiável".
 *   2. Senão (ou se Brave falhar) → cai pro DuckDuckGo HTML scrape (zero
 *      config, mas DDG bloqueia IPs ocasionalmente).
 *
 * Hardening:
 * - Rate limit por IP (mesmo bucket dos endpoints /api/fs/*)
 * - Timeout de 10s
 * - URLs validam scheme http/https
 * - Retorna `{ results, provider }` indicando qual backend respondeu
 * - Em caso de falha, retorna `errorCode` semântico ("anti-bot", "no-results",
 *   "network", "auth") pra UI poder oferecer ação contextual.
 */
/* Núcleo reutilizável da busca: tenta Brave (se houver key) e cai pro DDG.
   Retorna { results, provider } ou lança Error com `.code` semântico
   ("auth" | "bad-request" | "anti-bot" | "no-results" | "network").
   Usado tanto pelo handler HTTP quanto pelas tarefas agendadas (boletim). */
async function webSearchCore(query, braveApiKey) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) { const e = new Error("query obrigatória"); e.code = "bad-request"; throw e; }
  if (q.length > 500) { const e = new Error("query excede 500 caracteres"); e.code = "bad-request"; throw e; }

  // Prefere a key vinda do caller (client). Fallback para env.
  const braveKey = (typeof braveApiKey === "string" && braveApiKey.trim())
    || BRAVE_SEARCH_API_KEY_ENV
    || "";

  const errors = [];
  if (braveKey) {
    try {
      const results = await fetchBraveResults(q, braveKey);
      if (results.length) return { results, provider: "brave" };
      errors.push("brave: sem resultados");
    } catch (err) {
      console.error("[Search/brave] Fail:", err.message);
      errors.push(`brave: ${err.message}`);
      // Key inválida: não cai pro DDG (usuário precisa ver isso).
      if (err.code === "auth") {
        const e = new Error(`Brave API key inválida ou expirada: ${err.message}`);
        e.code = "auth";
        throw e;
      }
    }
  }

  try {
    const results = await fetchDuckDuckGoResults(q);
    return { results, provider: "duckduckgo" };
  } catch (err) {
    console.error("[Search/ddg] Fail:", err.message);
    errors.push(`duckduckgo: ${err.message}`);
    const e = new Error(errors.join(" | "));
    e.code = err.code || "network";
    throw e;
  }
}

async function handleToolsWebSearch(body, response, request) {
  if (request && rateLimited(request)) {
    return sendJson(response, 429, { error: "Muitas buscas, aguarde.", errorCode: "rate-limit" });
  }
  try {
    const out = await webSearchCore(body.query, body.braveApiKey);
    return sendJson(response, 200, out);
  } catch (err) {
    const code = err.code || "network";
    const status = code === "auth" ? 401 : code === "bad-request" ? 400 : 502;
    return sendJson(response, status, { error: err.message, errorCode: code });
  }
}

/* Brave Search API — JSON limpo, free tier 2000/mês.
   Docs: https://api.search.brave.com/app/documentation/web-search/get-started */
function fetchBraveResults(query, apiKey) {
  return new Promise((resolve, reject) => {
    const path = `/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const req = https.request(
      {
        method: "GET",
        hostname: "api.search.brave.com",
        path,
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "identity",
          "X-Subscription-Token": apiKey,
        },
      },
      (res) => {
        const status = res.statusCode;
        if (status !== 200) {
          res.resume();
          const err = new Error(`Brave retornou HTTP ${status}.`);
          if (status === 401 || status === 403) err.code = "auth";
          else if (status === 429) err.code = "rate-limit";
          reject(err);
          return;
        }
        let raw = "";
        let bytes = 0;
        const MAX_BYTES = 2 * 1024 * 1024;
        res.on("data", (c) => {
          bytes += c.length;
          if (bytes > MAX_BYTES) {
            req.destroy(new Error("Brave: resposta excedeu 2 MiB."));
            return;
          }
          raw += c;
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            const items = data?.web?.results || [];
            const results = [];
            for (const it of items.slice(0, 5)) {
              const url = safeHttpUrl(it.url);
              if (!url) continue;
              results.push({
                title: stripHtml(it.title || ""),
                url,
                snippet: stripHtml(it.description || ""),
              });
            }
            resolve(results);
          } catch (err) {
            reject(new Error(`Brave: parse falhou (${err.message})`));
          }
        });
      }
    );
    req.setTimeout(10_000, () => req.destroy(new Error("Timeout Brave (10s).")));
    req.on("error", reject);
    req.end();
  });
}

function safeHttpUrl(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.toString() : null;
  } catch {
    return null;
  }
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/* Wrapper com retry inteligente:
   - Erros de rede/timeout: 1 retry após 3s (ajuda com blips transitórios)
   - HTTP 202 / anti-bot: NÃO faz retry (DDG ainda vai bloquear, só atrasa o erro)
   - Sem resultados: NÃO faz retry (mais buscas não vão criar resultados) */
async function fetchDuckDuckGoResults(query) {
  try {
    return await fetchDuckDuckGoOnce(query);
  } catch (err) {
    if (err.code === "anti-bot" || err.code === "no-results") throw err;
    // Network/timeout — espera 3s e tenta uma vez mais.
    await new Promise((r) => setTimeout(r, 3000));
    return fetchDuckDuckGoOnce(query);
  }
}

function fetchDuckDuckGoOnce(query) {
  return new Promise((resolve, reject) => {
    const body = `q=${encodeURIComponent(query)}`;
    const req = https.request(
      {
        method: "POST",
        hostname: "html.duckduckgo.com",
        path: "/html/",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const status = res.statusCode;
        if (status !== 200) {
          res.resume(); // drain to free socket
          if (status === 202) {
            const e = new Error(
              "DuckDuckGo bloqueou temporariamente este IP (anti-bot). " +
              "Aguarde alguns minutos e tente novamente, ou configure uma chave Brave Search em Configurações → Avançado."
            );
            e.code = "anti-bot";
            reject(e);
          } else {
            const e = new Error(`DuckDuckGo retornou HTTP ${status}.`);
            e.code = "network";
            reject(e);
          }
          return;
        }
        let html = "";
        let bytes = 0;
        const MAX_HTML = 2 * 1024 * 1024; // 2 MiB de HTML é mais que suficiente
        res.on("data", (c) => {
          bytes += c.length;
          if (bytes > MAX_HTML) {
            req.destroy(new Error("Resposta DDG excedeu 2 MiB."));
            return;
          }
          html += c;
        });
        res.on("end", () => {
          // Mesmo com HTTP 200, DDG pode mandar a página de challenge (anomaly).
          if (html.includes("anomaly.js") || html.includes("challenge-form")) {
            const e = new Error(
              "DuckDuckGo exigiu CAPTCHA (anti-bot). " +
              "Aguarde alguns minutos ou configure uma chave Brave Search em Configurações → Avançado."
            );
            e.code = "anti-bot";
            reject(e);
            return;
          }
          try {
            const results = parseDuckDuckGoHtml(html);
            if (!results.length) {
              const e = new Error("Nenhum resultado encontrado para esta query.");
              e.code = "no-results";
              reject(e);
            } else {
              resolve(results);
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(10_000, () => {
      req.destroy(new Error("Timeout DuckDuckGo (10s)."));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* Decodifica o redirect do DDG (/l/?uddg=...) e valida o scheme.
   Retorna null se a URL não puder ser confiada (javascript:, data:, blob:, etc). */
function safeExtractDdgUrl(rawHref) {
  if (typeof rawHref !== "string" || !rawHref) return null;
  try {
    let u = new URL(rawHref, "https://duckduckgo.com");
    if (u.host.endsWith("duckduckgo.com") && u.pathname === "/l/") {
      const inner = u.searchParams.get("uddg");
      if (inner) u = new URL(inner);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/* Parser do HTML do DDG. Splita por `result__body` (cada result vira um chunk
   da posição atual até o próximo `result__body` ou fim do HTML), depois extrai
   title/url/snippet de cada chunk. Mais robusto que tentar regex de bloco
   fechado porque a marcação tem divs aninhadas que enganam `</div></div>`. */
function parseDuckDuckGoHtml(html) {
  const results = [];
  // Posições onde cada result começa
  const starts = [];
  const re = /class="[^"]*\bresult__body\b/g;
  let m;
  while ((m = re.exec(html)) !== null) starts.push(m.index);
  if (!starts.length) {
    console.warn("[ddg-parser] nenhum result__body encontrado — markup pode ter mudado. Prefixo:", html.slice(0, 300));
    return results;
  }
  starts.push(html.length); // sentinela pro último chunk

  for (let i = 0; i < starts.length - 1 && results.length < 5; i++) {
    const chunk = html.slice(starts[i], starts[i + 1]);
    const titleMatch = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    if (!titleMatch) continue;
    const url = safeExtractDdgUrl(titleMatch[1]);
    if (!url) continue;
    const title = titleMatch[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snippetMatch = /<(?:a|span)[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/.exec(chunk);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "";
    results.push({ title, url, snippet });
  }

  return results;
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
  safeExtractDdgUrl,
  rateLimited,
  webSearchCore,
  cron,
  safeWriter,
  safeReader,
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
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    CRON_ENABLED,
    FS_WRITE_ROOTS,
    CRON_STATE_DIR,
    CRON_TZ,
    MAX_WRITE_BYTES,
  },
};
