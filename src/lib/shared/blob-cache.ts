/**
 * A small IndexedDB key → value store for results too big for localStorage (an NFL model replay is
 * ~2 MB). Browser-only and best-effort: without IndexedDB nothing is saved and callers just recompute.
 * `preload(prefix)` reads every saved value under a prefix into memory once, so callers can then look
 * them up synchronously; `whenLoaded()` resolves when that read is done.
 */
const DB_NAME = "gamblingnfl-results";
const STORE = "results";

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const memory = new Map<string, unknown>();
let loaded: Promise<void> | null = null;

/** Reads every saved value into memory (once). */
export function whenLoaded(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          memory.set(String(cur.key), cur.value);
          cur.continue();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  return loaded;
}

export function getSaved<T>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

/** Saves `value` under `key`, replacing (and deleting) anything else saved under the same prefix. */
export function saveReplacing(prefix: string, key: string, value: unknown) {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix) && k !== key) memory.delete(k);
  memory.set(key, value);
  void openDb().then((db) => {
    if (!db) return;
    try {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result)
          if (String(k).startsWith(prefix) && String(k) !== key) store.delete(k);
        store.put(value, key);
      };
    } catch {
      // not saved: the next visit recomputes
    }
  });
}
