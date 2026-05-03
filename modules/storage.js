/* Storage wrapper: localStorage by default, transparent IndexedDB fallback
   when payload exceeds threshold (used for conversations). */

const DB_NAME = "offline-ai";
const DB_VERSION = 2;
const STORE_CONVOS = "conversations";
const STORE_HANDLES = "handles";
const STORE_EMBEDDINGS = "embeddings";
const STORE_EMBEDDING_META = "embedding_meta";

const LS_THRESHOLD = 2 * 1024 * 1024; // 2 MB

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CONVOS)) {
        db.createObjectStore(STORE_CONVOS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
        const s = db.createObjectStore(STORE_EMBEDDINGS, { keyPath: "id" });
        s.createIndex("by_source", "sourceId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_EMBEDDING_META)) {
        db.createObjectStore(STORE_EMBEDDING_META, { keyPath: "sourceId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const LS_KEY_CONVOS = "offline-ai-chat:conversations:v1";

export const conversationStore = {
  async list() {
    try {
      const raw = localStorage.getItem(LS_KEY_CONVOS);
      if (raw) return JSON.parse(raw);
    } catch {}
    try {
      return await idbAll(STORE_CONVOS);
    } catch {
      return [];
    }
  },
  async get(id) {
    const raw = localStorage.getItem(LS_KEY_CONVOS);
    if (raw) {
      try {
        const all = JSON.parse(raw);
        const found = all.find((c) => c.id === id);
        if (found) return found;
      } catch {}
    }
    try { return await idbGet(STORE_CONVOS, id); }
    catch { return null; }
  },
  async upsert(conv) {
    const all = await this.list();
    const idx = all.findIndex((c) => c.id === conv.id);
    if (idx >= 0) all[idx] = conv;
    else all.unshift(conv);
    const json = JSON.stringify(all);
    if (json.length < LS_THRESHOLD) {
      try { localStorage.setItem(LS_KEY_CONVOS, json); return; }
      catch (e) { console.warn("LS quota exceeded, falling back to IDB", e); }
    }
    // overflow → IDB
    try { localStorage.removeItem(LS_KEY_CONVOS); } catch {}
    for (const c of all) await idbPut(STORE_CONVOS, c);
  },
  async remove(id) {
    const raw = localStorage.getItem(LS_KEY_CONVOS);
    if (raw) {
      try {
        const all = JSON.parse(raw).filter((c) => c.id !== id);
        localStorage.setItem(LS_KEY_CONVOS, JSON.stringify(all));
      } catch {}
    }
    try { await idbDelete(STORE_CONVOS, id); } catch {}
  },
  async clear() {
    try { localStorage.removeItem(LS_KEY_CONVOS); } catch {}
    try { await idbClear(STORE_CONVOS); } catch {}
  },
};

/* Embedding store — vectors for RAG.
   Schema per record:
     { id, sourceId, fileId, path, chunkIdx, text, lineStart, lineEnd, vec: Float32Array, dim }
   Meta per source:
     { sourceId, embeddingModel, embeddingDim, chunkCount, fileCount, indexedAt } */

export const embeddingStore = {
  async putBatch(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readwrite");
      const s = tx.objectStore(STORE_EMBEDDINGS);
      for (const r of records) s.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async listBySource(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readonly");
      const idx = tx.objectStore(STORE_EMBEDDINGS).index("by_source");
      const req = idx.getAll(sourceId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteBySource(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readwrite");
      const idx = tx.objectStore(STORE_EMBEDDINGS).index("by_source");
      const cursorReq = idx.openCursor(IDBKeyRange.only(sourceId));
      cursorReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          cur.delete();
          cur.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async countBySource(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDINGS, "readonly");
      const idx = tx.objectStore(STORE_EMBEDDINGS).index("by_source");
      const req = idx.count(sourceId);
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  },

  async getMeta(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDING_META, "readonly");
      const req = tx.objectStore(STORE_EMBEDDING_META).get(sourceId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async putMeta(meta) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDING_META, "readwrite");
      tx.objectStore(STORE_EMBEDDING_META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteMeta(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDING_META, "readwrite");
      tx.objectStore(STORE_EMBEDDING_META).delete(sourceId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async listAllMeta() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMBEDDING_META, "readonly");
      const req = tx.objectStore(STORE_EMBEDDING_META).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
};

export const handleStore = {
  async put(id, handle) {
    try { await idbPut(STORE_HANDLES, { id, handle }); }
    catch (e) { console.warn("handle put failed", e); }
  },
  async get(id) {
    try { const r = await idbGet(STORE_HANDLES, id); return r?.handle || null; }
    catch { return null; }
  },
  async remove(id) {
    try { await idbDelete(STORE_HANDLES, id); } catch {}
  },
  async list() {
    try { return await idbAll(STORE_HANDLES); }
    catch { return []; }
  },
};
