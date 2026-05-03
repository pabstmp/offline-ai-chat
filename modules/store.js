/* Tiny reactive store: Proxy + pubsub.
   Subscribers receive (key, value, prev). Path-based subscribers receive only
   updates on their slice (e.g. "appearance.theme"). */

export function createStore(initial) {
  const subs = new Set();
  const pathSubs = new Map(); // path -> Set<fn>

  function notify(path, value, prev) {
    subs.forEach((fn) => {
      try { fn(path, value, prev); } catch (e) { console.error(e); }
    });
    for (const [p, set] of pathSubs.entries()) {
      if (path === p || path.startsWith(p + ".")) {
        set.forEach((fn) => {
          try { fn(value, prev, path); } catch (e) { console.error(e); }
        });
      }
    }
  }

  function makeProxy(target, basePath = "") {
    return new Proxy(target, {
      get(t, key) {
        const v = t[key];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return makeProxy(v, basePath ? `${basePath}.${String(key)}` : String(key));
        }
        return v;
      },
      set(t, key, value) {
        const fullPath = basePath ? `${basePath}.${String(key)}` : String(key);
        const prev = t[key];
        if (prev === value) return true;
        t[key] = value;
        notify(fullPath, value, prev);
        return true;
      },
      deleteProperty(t, key) {
        const fullPath = basePath ? `${basePath}.${String(key)}` : String(key);
        const prev = t[key];
        delete t[key];
        notify(fullPath, undefined, prev);
        return true;
      },
    });
  }

  const data = JSON.parse(JSON.stringify(initial || {}));
  const state = makeProxy(data);

  return {
    state,
    raw: () => data,
    set(path, value) {
      const parts = path.split(".");
      let node = state;
      for (let i = 0; i < parts.length - 1; i++) {
        if (node[parts[i]] == null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
    },
    get(path) {
      const parts = path.split(".");
      let node = data;
      for (const p of parts) {
        if (node == null) return undefined;
        node = node[p];
      }
      return node;
    },
    replace(next) {
      Object.keys(data).forEach((k) => { delete data[k]; });
      Object.assign(data, JSON.parse(JSON.stringify(next || {})));
      notify("", data, null);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    on(path, fn) {
      if (!pathSubs.has(path)) pathSubs.set(path, new Set());
      pathSubs.get(path).add(fn);
      return () => pathSubs.get(path)?.delete(fn);
    },
  };
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
