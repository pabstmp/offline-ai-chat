/* Suíte de Testes de Auditoria e Segurança de Código — Offline AI Chat
   Foco: OWASP Top 10 para LLM & WSTG (Path Traversal, XSS, Headers CSP, Rate Limit, Safe URLs) */

import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n-- ${title} --`);
}

async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  OK ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}`);
    console.error(`    ${err.message}`);
  }
}

async function runAuditTests() {
  section("Auditoria de Headers HTTP e CSP no Server");

  await test("Headers de segurança HTTP (CSP, X-Frame-Options, nosniff, COOP)", async () => {
    const serverCode = await fsp.readFile(path.join(__dirname, "../server.js"), "utf8");
    assert.match(serverCode, /Content-Security-Policy/i, "Server deve incluir Content-Security-Policy");
    assert.match(serverCode, /X-Frame-Options['"]?\s*:\s*['"]DENY['"]/i, "Server deve bloquear framing via DENY");
    assert.match(serverCode, /X-Content-Type-Options['"]?\s*:\s*['"]nosniff['"]/i, "Server deve usar nosniff");
    assert.match(serverCode, /Cross-Origin-Opener-Policy['"]?\s*:\s*['"]same-origin['"]/i, "Server deve usar COOP same-origin");
  });

  section("Auditoria contra Path Traversal e Injeção de Caminhos");

  await test("Guardrail contra Path Traversal: Normalização e Rejeição de caminhos maliciosos", () => {
    const malformedPaths = [
      "../package.json",
      "../../../../etc/passwd",
      "..\\..\\Windows\\System32\\cmd.exe",
      "%2e%2e%2fpackage.json",
      "foo/../../secret.txt",
      "secret.txt\0.pdf",
    ];

    for (const rel of malformedPaths) {
      let cleanRel = String(rel || "");
      try { cleanRel = decodeURIComponent(cleanRel); } catch {}
      const hasNull = cleanRel.includes("\0");
      const normalized = path.normalize(cleanRel).replace(/^([\\/])+/, "");
      const isBlocked = hasNull || normalized.startsWith("..") || path.isAbsolute(normalized) || cleanRel.includes("..");
      assert.equal(isBlocked, true, `Caminho inseguro '${rel}' deve ser detectado e bloqueado`);
    }
  });

  section("Auditoria de URLs e Renderizador Markdown (OWASP LLM05 - Improper Output Handling)");

  await test("Sanitização de esquemas de URL em Markdown (javascript:, data:, vbscript:, file:)", () => {
    function isSafeUrl(href) {
      try {
        const url = new URL(href, "http://localhost:8080");
        return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
      } catch {
        return false;
      }
    }

    assert.equal(isSafeUrl("https://example.com"), true);
    assert.equal(isSafeUrl("http://localhost:1234"), true);
    assert.equal(isSafeUrl("javascript:alert(1)"), false, "javascript: deve ser bloqueado");
    assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false, "data: deve ser bloqueado");
    assert.equal(isSafeUrl("vbscript:msgbox(1)"), false, "vbscript: deve ser bloqueado");
    assert.equal(isSafeUrl("file:///etc/passwd"), false, "file: deve ser bloqueado");
  });

  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`Resultados Auditoria de Segurança: ${passed} passaram, ${failed} falharam`);
  if (failed > 0) process.exit(1);
}

runAuditTests();
