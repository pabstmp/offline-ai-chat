import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverPath = require.resolve("../server.js");

const ENV_KEYS = [
  "HOST",
  "APP_AUTH_TOKEN",
  "APP_AUTH_PASSWORD",
  "APP_AUTH_USER",
  "ALLOWED_LM_HOSTS",
  "WORKSPACE_ROOTS",
  "ALLOW_UNRESTRICTED_WORKSPACE",
  "MAX_BODY_BYTES",
  "MAX_FILE_BYTES",
  "MAX_PDF_BYTES",
];

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n-- ${title} --`);
}

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}`);
    console.error(`    ${err.message}`);
  }
}

function withServer(env = {}) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value != null) process.env[key] = String(value);
  }
  delete require.cache[serverPath];
  const mod = require(serverPath);
  for (const [key, value] of previous) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return mod;
}

function basic(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "offline-ai-security-"));
fs.mkdirSync(path.join(tmpRoot, "sub"));
fs.writeFileSync(path.join(tmpRoot, "sub", "ok.txt"), "hello", "utf8");

section("Static allowlist");
{
  const server = withServer();
  test("allows only app shell and browser modules", () => {
    assert.equal(server.isStaticPathAllowed("/"), true);
    assert.equal(server.isStaticPathAllowed("/app.js"), true);
    assert.equal(server.isStaticPathAllowed("/modules/api.js"), true);
    assert.equal(server.isStaticPathAllowed("/assets/screenshot.png"), true);
    assert.equal(server.isStaticPathAllowed("/server.js"), false);
    assert.equal(server.isStaticPathAllowed("/package.json"), false);
    assert.equal(server.isStaticPathAllowed("/modules/package.json"), false);
    assert.equal(server.isStaticPathAllowed("/.env"), false);
    assert.equal(server.isStaticPathAllowed("/assets/tool.js"), false);
  });
}

section("Workspace guard");
{
  const local = withServer();
  test("allows local single-user workspace by default", () => {
    const resolved = local.resolveSafePath(tmpRoot, "sub/ok.txt");
    assert.equal(fs.readFileSync(resolved.absolute, "utf8"), "hello");
  });

  test("blocks path traversal", () => {
    assert.throws(() => local.resolveSafePath(tmpRoot, "../outside.txt"), /relPath|Acesso/);
  });

  const lan = withServer({ HOST: "0.0.0.0" });
  test("requires WORKSPACE_ROOTS when bound to LAN", () => {
    assert.equal(lan.config.ALLOW_UNRESTRICTED_WORKSPACE, false);
    assert.throws(() => lan.resolveSafePath(tmpRoot, "sub/ok.txt"), /WORKSPACE_ROOTS/);
  });

  const rooted = withServer({ HOST: "0.0.0.0", WORKSPACE_ROOTS: tmpRoot });
  test("allows whitelisted workspace root on LAN", () => {
    const resolved = rooted.resolveSafePath(tmpRoot, "sub/ok.txt");
    assert.equal(fs.readFileSync(resolved.absolute, "utf8"), "hello");
  });
}

section("LM proxy allowlist");
{
  const lan = withServer({ HOST: "0.0.0.0" });
  test("LAN mode allows loopback LM Studio by default", () => {
    assert.doesNotThrow(() => lan.normalizeBaseUrl("http://localhost:1234/v1"));
  });
  test("LAN mode blocks arbitrary upstream hosts by default", () => {
    assert.throws(() => lan.normalizeBaseUrl("http://example.com:1234/v1"), /nao autorizado/);
  });

  const allowed = withServer({ HOST: "0.0.0.0", ALLOWED_LM_HOSTS: "example.com:1234" });
  test("ALLOWED_LM_HOSTS allows exact host:port", () => {
    assert.doesNotThrow(() => allowed.normalizeBaseUrl("http://example.com:1234/v1"));
    assert.throws(() => allowed.normalizeBaseUrl("http://example.com:9999/v1"), /nao autorizado/);
  });
}

section("Auth and Origin");
{
  const auth = withServer({ APP_AUTH_TOKEN: "secret" });
  test("Basic auth accepts configured token", () => {
    assert.equal(auth.config.AUTH_ENABLED, true);
    assert.equal(auth.isAuthenticated({ headers: { authorization: basic("offline-ai", "secret") } }), true);
    assert.equal(auth.isAuthenticated({ headers: { authorization: basic("offline-ai", "wrong") } }), false);
    assert.equal(auth.isAuthenticated({ headers: {} }), false);
  });

  const server = withServer();
  test("Origin guard allows same-origin API requests only", () => {
    assert.equal(server.isSameOriginRequestAllowed({ headers: {} }), true);
    assert.equal(server.isSameOriginRequestAllowed({ headers: { origin: "http://app.local:8080", host: "app.local:8080" } }), true);
    assert.equal(server.isSameOriginRequestAllowed({ headers: { origin: "http://evil.local", host: "app.local:8080" } }), false);
  });
}

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

// ─────────────────────────────────────────────────────────────────────────────
// safeExtractDdgUrl — scheme injection guard
// ─────────────────────────────────────────────────────────────────────────────
section("safeExtractDdgUrl — scheme injection guard");
{
  const mod = withServer();
  test("aceita https direto", () => {
    assert.equal(mod.safeExtractDdgUrl("https://example.com"), "https://example.com/");
  });
  test("aceita http direto", () => {
    assert.equal(mod.safeExtractDdgUrl("http://example.com"), "http://example.com/");
  });
  test("bloqueia javascript:", () => {
    assert.equal(mod.safeExtractDdgUrl("javascript:alert(1)"), null);
  });
  test("bloqueia data:", () => {
    assert.equal(mod.safeExtractDdgUrl("data:text/html,<h1>x</h1>"), null);
  });
  test("decodifica redirect /l/?uddg=", () => {
    assert.equal(
      mod.safeExtractDdgUrl("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F"),
      "https://example.com/"
    );
  });
  test("bloqueia javascript: dentro de /l/?uddg=", () => {
    assert.equal(
      mod.safeExtractDdgUrl("https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)"),
      null
    );
  });
  test("string vazia retorna null", () => {
    assert.equal(mod.safeExtractDdgUrl(""), null);
  });
  test("null retorna null", () => {
    assert.equal(mod.safeExtractDdgUrl(null), null);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// rateLimited — cobre /api/tools/web-search e /api/fs/*
// ─────────────────────────────────────────────────────────────────────────────
section("rateLimited — threshold e isolamento por IP");
{
  const mod = withServer();
  const fakeReq = { socket: { remoteAddress: "10.0.0.1" } };
  test("bloqueia após RATE_LIMIT_MAX requisições do mesmo IP", () => {
    for (let i = 0; i < mod.config.RATE_LIMIT_MAX; i++) mod.rateLimited(fakeReq);
    assert.equal(mod.rateLimited(fakeReq), true);
  });

  const mod2 = withServer();
  test("não contamina IPs diferentes no mesmo bucket", () => {
    const r1 = { socket: { remoteAddress: "10.0.0.1" } };
    const r2 = { socket: { remoteAddress: "10.0.0.2" } };
    for (let i = 0; i < mod2.config.RATE_LIMIT_MAX + 1; i++) mod2.rateLimited(r1);
    assert.equal(mod2.rateLimited(r2), false);
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
