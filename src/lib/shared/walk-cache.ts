/**
 * Walk-forward model runs, remembered between page loads.
 *
 * Every model on the site grades a season by predicting each day's games from the games before that
 * day (one ratings fit per day). For college basketball that is ~125 fits over 6,000 games, about a
 * second of work, and it used to run again on every reload and every schedule refresh. A past day's
 * predictions only change when the games before it change (a new final, a corrected score or line), so
 * they are saved here (in memory and in the browser's localStorage) under a fingerprint of those games:
 *   - unchanged history → every day is a cache hit, nothing is refit;
 *   - a game goes final → only the days after it are refit (in practice: the newest day).
 * Model code changes are caught by always refitting the newest day and comparing it with the saved copy:
 * if they differ, the whole saved run is thrown away and rebuilt.
 */

type DayEntry = string; // JSON of the day's predictions, in the day's game order

interface Store {
  days: Map<string, DayEntry>;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const stores = new Map<string, Store>();
const LS_PREFIX = "gnfl-walk:";
/** Don't let one league's saved run take over the browser's storage. */
const MAX_SAVED_CHARS = 2_500_000;

function storeFor(name: string): Store {
  let s = stores.get(name);
  if (s) return s;
  s = { days: new Map(), dirty: false, timer: null };
  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(LS_PREFIX + name);
      if (raw) for (const [k, v] of JSON.parse(raw) as [string, string][]) s.days.set(k, v);
    }
  } catch {
    // no storage (private mode) or a broken copy: start empty
  }
  stores.set(name, s);
  return s;
}

function scheduleSave(name: string, s: Store) {
  if (typeof window === "undefined" || s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    if (!s.dirty) return;
    s.dirty = false;
    try {
      const json = JSON.stringify([...s.days]);
      if (json.length <= MAX_SAVED_CHARS) window.localStorage.setItem(LS_PREFIX + name, json);
      else window.localStorage.removeItem(LS_PREFIX + name);
    } catch {
      // storage full or blocked: keep the in-memory copy only
    }
  }, 1_500);
}

/** FNV-1a over a string, continuing from `h`. */
export function hashStep(h: number, s: string): number {
  let x = h >>> 0;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x;
}
const FNV = 2166136261;

/**
 * Runs `predictDay` for each day of `finals` (sorted by date, grouped by `dayOf`), reusing saved
 * results when the games before that day are unchanged. `sig(g)` must include everything about a
 * finished game the model reads (scores, lines, possessions…); `salt` covers other inputs (a prior).
 * Returns each final's prediction by game id.
 */
export function walkForward<G extends { id: string }, P>(
  name: string,
  finals: G[],
  dayOf: (g: G) => string,
  sig: (g: G) => string,
  predictDay: (before: G[], dayGames: G[], dayIndex: number) => P[],
  salt = "",
): Map<string, P> {
  const store = storeFor(name);
  const days: { day: string; start: number; games: G[] }[] = [];
  for (let i = 0; i < finals.length; i++) {
    const d = dayOf(finals[i]);
    const last = days[days.length - 1];
    if (last && last.day === d) last.games.push(finals[i]);
    else days.push({ day: d, start: i, games: [finals[i]] });
  }
  // fingerprint of everything before each day
  const keys: string[] = [];
  let h = hashStep(FNV, salt);
  let cursor = 0;
  for (const d of days) {
    while (cursor < d.start) h = hashStep(h, sig(finals[cursor++]));
    let ids = FNV;
    for (const g of d.games) ids = hashStep(ids, g.id);
    keys.push(`${d.day}|${h.toString(36)}|${ids.toString(36)}`);
  }
  const out = new Map<string, P>();
  const fresh = (i: number) => predictDay(finals.slice(0, days[i].start), days[i].games, i);
  // Newest day: always refit, and if the saved copy disagrees the model changed: drop everything saved.
  if (days.length) {
    const i = days.length - 1;
    const preds = fresh(i);
    const json = JSON.stringify(preds);
    const saved = store.days.get(keys[i]);
    if (saved !== undefined && saved !== json) {
      store.days.clear();
    }
    if (saved !== json) {
      store.days.set(keys[i], json);
      store.dirty = true;
    }
    days[i].games.forEach((g, k) => out.set(g.id, preds[k]));
  }
  const live = new Set(keys);
  for (let i = 0; i < days.length - 1; i++) {
    const saved = store.days.get(keys[i]);
    let preds: P[] | null = null;
    if (saved !== undefined) {
      try {
        preds = JSON.parse(saved) as P[];
      } catch {
        preds = null;
      }
    }
    if (!preds || preds.length !== days[i].games.length) {
      preds = fresh(i);
      store.days.set(keys[i], JSON.stringify(preds));
      store.dirty = true;
    }
    days[i].games.forEach((g, k) => out.set(g.id, preds![k]));
  }
  // forget days that no longer exist (an older season, a changed history)
  for (const k of store.days.keys())
    if (!live.has(k)) {
      store.days.delete(k);
      store.dirty = true;
    }
  if (store.dirty) scheduleSave(name, store);
  return out;
}

/** Tests: forget everything saved. */
export function resetWalkCache() {
  stores.clear();
  try {
    if (typeof window !== "undefined")
      for (const k of Object.keys(window.localStorage))
        if (k.startsWith(LS_PREFIX)) window.localStorage.removeItem(k);
  } catch {
    // no storage
  }
}
