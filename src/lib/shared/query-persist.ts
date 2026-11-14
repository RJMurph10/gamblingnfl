/**
 * Keeps a copy of the site's queries in the browser (IndexedDB): schedules, lines, props boards, model
 * inputs, trackers. A page you've visited before shows its data instantly on the next visit (no
 * "Loading…"), then quietly refreshes from the server and only changes on screen if the data did. Finished games
 * therefore never wait on ESPN again; live and upcoming games still update as soon as the refresh lands.
 *
 * Browser-only and best-effort: if IndexedDB is unavailable (private mode, old browser) nothing is
 * saved and the site simply loads as before.
 */
import { useEffect } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Every query is kept except live per-game detail (box score / play-by-play, refreshed every few seconds
 * while a game is on), where a saved copy would show an old score until the refresh lands. NFL / college
 * football game pages ("nfl-game") are kept while upcoming or finished, never while live (see gameCopyOk).
 */
const NOT_PERSISTED = new Set([
  "nba-game",
  "nhl-game",
  "mlb-game",
  "cbb-game",
  "wcbb-game",
  "wnba-game",
  "game-props",
]);
// v2 (Nov 2026): the first cache read every saved query at startup with getAll() and kept multi-MB
// datasets (whole seasons of props, NFL history). On iPhones that froze page loads for minutes, so v2
// reads each query only when a page asks for it, skips large results, and deletes the old database.
const DB_NAME = "gamblingnfl-cache-v2";
const OLD_DB_NAMES = ["gamblingnfl-cache"];
/** Results bigger than this (JSON characters) aren't saved: reading them back costs more than refetching. */
const MAX_SAVED_CHARS = 750_000;
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
export function withoutStaleLive(
  entry: Pick<Saved, "data" | "updatedAt">,
  now = Date.now(),
): unknown {
  if (now - entry.updatedAt < LIVE_FRESH_MS) return entry.data;
  const notLive = (g: unknown) => (g as { status?: unknown } | null)?.status !== "live";
  if (Array.isArray(entry.data)) return entry.data.filter(notLive);
  // schedules shaped { games: [...], ... } (college basketball, WNBA, MLB)
  const d = entry.data as { games?: unknown } | null;
  if (d && typeof d === "object" && Array.isArray(d.games))
    return { ...d, games: d.games.filter(notLive) };
  return entry.data;
}

/**
 * A single game's page (NFL / college football "nfl-game"): saved and restored only when the copy can't
 * be misleading: never a live game, and never an upcoming copy once its kickoff has passed (the game may
 * be live now).
 */
export function gameCopyOk(data: unknown, now = Date.now()): boolean {
  const g = data as { status?: string; kickoffIso?: string } | null;
  if (!g || typeof g !== "object" || !("status" in g)) return true;
  if (g.status === "live") return false;
  if (g.status === "scheduled" && g.kickoffIso && Date.parse(g.kickoffIso) <= now) return false;
  return true;
}
const GAME_KEYS = new Set(["nfl-game"]);

interface Saved {
  key: string;
  queryKey: QueryKey;
  data: unknown;
  updatedAt: number;
}

const persisted = (queryKey: QueryKey) =>
  typeof queryKey[0] === "string" && !NOT_PERSISTED.has(queryKey[0]);

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: "key" });
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

async function read(key: string): Promise<Saved | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Saved | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function dropOldDatabases() {
  try {
    for (const name of OLD_DB_NAMES) indexedDB.deleteDatabase(name);
  } catch {
    // nothing to clean up
  }
}

/** Whether a result is over the size cap (JSON characters). */
function tooBig(data: unknown): boolean {
  try {
    return JSON.stringify(data).length > MAX_SAVED_CHARS;
  } catch {
    return true;
  }
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

    const tried = new Set<string>(); // keys already looked up this visit
    const big = new Set<string>(); // keys whose results are too large to save
    if (typeof indexedDB !== "undefined") dropOldDatabases();

    const restore = (entry: Saved) => {
      const state = queryClient.getQueryState(entry.queryKey);
      // Never overwrite data the server already delivered this visit.
      if (state?.dataUpdatedAt) return;
      // The old timestamp keeps the copy "stale", so the page still refreshes it in the background.
      queryClient.setQueryData(entry.queryKey, withoutStaleLive(entry), {
        updatedAt: entry.updatedAt,
      });
    };
    // Look up one query's saved copy, only when a page uses that query.
    const lookUp = (key: string, queryKey: QueryKey) => {
      if (tried.has(key) || !persisted(queryKey)) return;
      tried.add(key);
      void read(key).then((entry) => {
        if (cancelled || !entry) return;
        if (Date.now() - entry.updatedAt > MAX_AGE_MS) return void remove(key);
        if (GAME_KEYS.has(String(queryKey[0])) && !gameCopyOk(entry.data)) return;
        restore(entry);
      });
    };
    for (const q of queryClient.getQueryCache().getAll()) lookUp(q.queryHash, q.queryKey);

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "added") {
        lookUp(event.query.queryHash, event.query.queryKey);
        return;
      }
      if (event.type !== "updated" || event.action.type !== "success" || event.action.manual)
        return;
      const { query } = event;
      if (!persisted(query.queryKey) || query.state.data === undefined) return;
      if (GAME_KEYS.has(String(query.queryKey[0])) && !gameCopyOk(query.state.data)) return;
      const key = query.queryHash;
      if (big.has(key)) return;
      // Schedules refetch every few seconds during live games; save at most once per couple of seconds.
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          if (tooBig(query.state.data)) {
            big.add(key);
            void remove(key);
            return;
          }
          void put({
            key,
            queryKey: query.queryKey,
            data: query.state.data,
            updatedAt: query.state.dataUpdatedAt,
          });
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
