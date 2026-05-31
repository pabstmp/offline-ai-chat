/* server-lib/safe-write.js — escrita segura em disco para tarefas agendadas.
 *
 * O server.js original é READ-ONLY no filesystem. As tarefas de cron precisam
 * escrever (boletins, backups, rotação). Esta camada espelha o guard de leitura
 * (`resolveSafePath` em server.js) mas valida contra uma whitelist SEPARADA,
 * `FS_WRITE_ROOTS`, nunca contra `WORKSPACE_ROOTS` (que no Docker é montado :ro).
 *
 * Fail-closed: se nenhum write-root estiver configurado, qualquer escrita lança.
 *
 * É um factory (recebe deps injetadas) pra ficar testável sem subir o server e
 * pra reusar `translateWindowsPath`/`realpathIfExists` do server.js como fonte
 * única, evitando duplicar a tradução de paths Windows→container.
 */
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gzipAsync = promisify(zlib.gzip);

function isInsideRoot(candidate, root) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function defaultRealpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string[]} opts.writeRoots          raízes permitidas (cru, pode ser path Windows)
 * @param {(p:string)=>string} [opts.translateWindowsPath]
 * @param {(p:string)=>string|null} [opts.realpathIfExists]
 * @param {number} [opts.maxWriteBytes]
 */
function createSafeWriter(opts = {}) {
  const writeRoots = Array.isArray(opts.writeRoots) ? opts.writeRoots : [];
  const translateWindowsPath = opts.translateWindowsPath || ((p) => p);
  const realpath = opts.realpathIfExists || defaultRealpath;
  const maxWriteBytes = opts.maxWriteBytes || 5 * 1024 * 1024;

  let rootsCache = null;
  function getWriteRoots() {
    if (rootsCache) return rootsCache;
    rootsCache = writeRoots.map((raw) => {
      const translated = translateWindowsPath(raw);
      const resolved = path.resolve(translated);
      return realpath(resolved) || resolved;
    });
    return rootsCache;
  }

  /** Valida (writeRoot, relPath) e devolve { root, absolute }. Lança se inseguro. */
  function resolveSafeWritePath(writeRoot, relPath) {
    const roots = getWriteRoots();
    if (!roots.length) {
      throw new Error("FS_WRITE_ROOTS não configurado — escrita em disco desabilitada.");
    }
    if (typeof writeRoot !== "string" || typeof relPath !== "string") {
      throw new Error("writeRoot e relPath são obrigatórios.");
    }
    const translated = translateWindowsPath(writeRoot);
    const root = path.resolve(translated);
    const realRoot = realpath(root) || root;
    if (!roots.some((r) => isInsideRoot(realRoot, r))) {
      throw new Error("writeRoot não está autorizado em FS_WRITE_ROOTS.");
    }
    const normalizedRel = path.normalize(relPath).replace(/^([\\/])+/, "");
    if (normalizedRel.startsWith("..") || path.isAbsolute(normalizedRel)) {
      throw new Error("relPath inválido.");
    }
    const absolute = path.resolve(realRoot, normalizedRel);
    if (!isInsideRoot(absolute, realRoot)) {
      throw new Error("Escrita fora do writeRoot bloqueada.");
    }
    // Se um ancestral existente for symlink que escapa do root, bloqueia.
    const realParent = realpath(path.dirname(absolute));
    if (realParent && !isInsideRoot(realParent, realRoot)) {
      throw new Error("Escrita por symlink fora do writeRoot bloqueada.");
    }
    return { root: realRoot, absolute };
  }

  /** Escreve buffer/texto atomicamente (tmp + rename). Lança se exceder maxWriteBytes. */
  async function writeFileAtomically(absolute, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    if (buf.length > maxWriteBytes) {
      throw new Error(`Conteúdo (${buf.length} bytes) excede MAX_WRITE_BYTES (${maxWriteBytes}).`);
    }
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    const tmp = `${absolute}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, absolute);
    return buf.length;
  }

  async function writeTextFileAtomically(absolute, content) {
    return writeFileAtomically(absolute, content);
  }

  /** Copia um arquivo já-validado pra um destino, opcionalmente gzipando. */
  async function copyFileInto(srcAbsolute, destAbsolute, { gzip = false } = {}) {
    await fsp.mkdir(path.dirname(destAbsolute), { recursive: true });
    if (gzip) {
      const data = await fsp.readFile(srcAbsolute);
      const gz = await gzipAsync(data);
      await fsp.writeFile(`${destAbsolute}.gz`, gz);
      return gz.length;
    }
    await fsp.copyFile(srcAbsolute, destAbsolute);
    const st = await fsp.stat(destAbsolute);
    return st.size;
  }

  /** Gzipa um arquivo no lugar (cria <abs>.gz e remove o original). */
  async function gzipFileInPlace(absolute) {
    const data = await fsp.readFile(absolute);
    const gz = await gzipAsync(data);
    await fsp.writeFile(`${absolute}.gz`, gz);
    await fsp.unlink(absolute);
    return `${absolute}.gz`;
  }

  return {
    getWriteRoots,
    resolveSafeWritePath,
    writeFileAtomically,
    writeTextFileAtomically,
    copyFileInto,
    gzipFileInPlace,
    maxWriteBytes,
  };
}

module.exports = { createSafeWriter, isInsideRoot };
