/**
 * Keeps a copy of the big schedule queries in the browser (IndexedDB), so a page you've visited before
 * shows its games instantly on the next visit, then quietly refreshes from the server. Finished games
 * therefore never wait on ESPN again; live and upcoming games still update as soon as the refresh lands.
 *
 * Browser-only and best-effort: if IndexedDB is unavailable (private mode, old browser) nothing is
 * saved and the site simply loads as before.
 */
import { useEffect } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Queries worth keeping: whole-season schedules and last season's results. */
const PERSISTED = new Set([
  "live-schedule",
  "prior-season-results",
  "cfb-schedule",
  "cfb-prior-season",
  "nba-schedule",
  "nba-prior",
  "nhl-schedule",
]);
const DB_NAME = "gamblingnfl-cache";
const STORE = "queries";
const VERSION = 1;
/** Copies older than this are ignored (the season has moved on too much to be useful). */
const MAX_AGE_MS = 14 * 24 * 3_600_000;
const SAVE_DELAY_MS = 2_000;
/** A saved copy older than this can't say which games are live any more. */
const LIVE_FRESH_MS = 10 * 60_000;

/**
 * Games that were live when the copy was saved are left out once it's more than a few minutes old:
 * otherwise last night's games show as "live" (with last night's scores) until the refresh lands.
 * They come back, with their real status, as soon as the server answers.
 */
export function withoutStaleLive(entry: Pick<Saved, "data" | "updatedAt">, now = Date.now()): unknown {
  if (now - entry.updatedAt < LIVE_FRESH_MS || !Array.isArray(entry.data)) return entry.data;
  return entry.data.filter((g) => (g as { status?: unknown } | null)?.status !== "live");
}

interface Saved {
  key: string;
  queryKey: QueryKey;
  data: unknown;
  updatedAt: number;
}

const persisted = (queryKey: QueryKey) => typeof queryKey[0] === "string" && PERSISTED.has(queryKey[0]);

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
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

async function readAll(): Promise<Saved[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as Saved[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function put(entry: Saved): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
  } catch {
    // data that can't be stored (or a full disk) just isn't saved
  }
}

async function remove(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch {
    // ignore
  }
}

/**
 * Restores saved schedules into the query cache (only where nothing fresher has arrived yet) and saves
 * them again whenever they refresh. Call once, inside the QueryClientProvider.
 */
export function useQueryPersistence(queryClient: QueryClient) {
  useEffect(() => {
    let cancelled = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const saved = new Map<string, Saved>();
    const restore = (entry: Saved) => {
      const state = queryClient.getQueryState(entry.queryKey);
      // Never overwrite data the server already delivered this visit.
      if (state?.dataUpdatedAt) return;
      // The old timestamp keeps the copy "stale", so the page still refreshes it in the background.
      queryClient.setQueryData(entry.queryKey, withoutStaleLive(entry), { updatedAt: entry.updatedAt });
    };

    void readAll().then((entries) => {
      if (cancelled) return;
      for (const entry of entries) {
        if (!persisted(entry.queryKey) || Date.now() - entry.updatedAt > MAX_AGE_MS) {
          void remove(entry.key);
          continue;
        }
        saved.set(entry.key, entry);
        // Pages already open get their copy now; others get it when they open (below).
        if (queryClient.getQueryCache().get(entry.key)) restore(entry);
      }
    });

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "added") {
        const entry = saved.get(event.query.queryHash);
        if (entry) restore(entry);
        return;
      }
      if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) return;
      const { query } = event;
      if (!persisted(query.queryKey) || query.state.data === undefined) return;
      const key = query.queryHash;
      // Schedules refetch every few seconds during live games; save at most once per couple of seconds.
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const entry: Saved = { key, queryKey: query.queryKey, data: query.state.data, updatedAt: query.state.dataUpdatedAt };
          saved.set(key, entry);
          void put(entry);
        }, SAVE_DELAY_MS),
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [queryClient]);
}
