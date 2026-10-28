/**
 * Long-lived cache for data that can't change any more: finished games, finished weeks / date ranges,
 * and the lines of finished games. Server-only.
 *
 * Two layers:
 *  1. This server instance's memory (instant, lost when the instance is recycled).
 *  2. Cloudflare's edge cache, shared by every instance in a data centre and kept up to 30 days.
 *     Cloudflare may still clear it at any time, and it doesn't exist in the dev preview, where only
 *     memory is used. Every miss simply falls back to ESPN, so nothing breaks when it's empty.
 *
 * Only values the caller says are final are stored, so live and upcoming games always stay fresh.
 */
const memory = new Map<string, unknown>();
const MAX_MEMORY_KEYS = 4000;
const ORIGIN = "https://final-cache.gamblingnfl.internal/";
const DAY_SECONDS = 86_400;

function edgeCache(): any | null {
  try {
    const c = (globalThis as any).caches?.default;
    return c && typeof c.match === "function" && typeof c.put === "function" ? c : null;
  } catch {
    return null;
  }
}

function remember(key: string, value: unknown) {
  if (memory.size >= MAX_MEMORY_KEYS) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, value);
}

const requestFor = (key: string) => new Request(ORIGIN + encodeURIComponent(key));

/** A stored final value, or undefined when it isn't stored (in memory or at the edge). */
export async function readFinal<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  const cache = edgeCache();
  if (!cache) return undefined;
  try {
    const res = await cache.match(requestFor(key));
    if (!res) return undefined;
    const value = (await res.json()) as T;
    remember(key, value);
    return value;
  } catch {
    return undefined;
  }
}

/** Stores a final value (memory now; the edge in the background of this request). */
export async function writeFinal<T>(key: string, value: T, days = 30): Promise<void> {
  remember(key, value);
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(
      requestFor(key),
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${days * DAY_SECONDS}` },
      }),
    );
  } catch {
    // the edge cache is a bonus; memory still has it
  }
}

/** Returns the stored value, or loads it and stores it when `isFinal` says it can't change any more. */
export async function finalCached<T>(key: string, load: () => Promise<T>, isFinal: (value: T) => boolean): Promise<T> {
  const hit = await readFinal<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (isFinal(value)) await writeFinal(key, value);
  return value;
}

/**
 * Lines for finished games, grouped by month so a whole season needs only a handful of cache reads.
 * `get` returns the stored lines for the given game ids; `save` merges newly found lines in.
 */
export function finalLinesStore<O>(sport: string) {
  const keyFor = (month: string) => `${sport}-final-lines-${month}`;
  return {
    async get(games: { id: string; date: string }[]): Promise<Map<string, O>> {
      const months = [...new Set(games.map((g) => g.date.slice(0, 7)))];
      const out = new Map<string, O>();
      const maps = await Promise.all(months.map((m) => readFinal<Record<string, O>>(keyFor(m))));
      for (const map of maps) for (const [id, odds] of Object.entries(map ?? {})) out.set(id, odds);
      return out;
    },
    async save(found: { id: string; date: string; odds: O }[]): Promise<void> {
      const byMonth = new Map<string, { id: string; odds: O }[]>();
      for (const f of found) {
        const m = f.date.slice(0, 7);
        const list = byMonth.get(m) ?? [];
        list.push({ id: f.id, odds: f.odds });
        byMonth.set(m, list);
      }
      await Promise.all(
        [...byMonth.entries()].map(async ([m, list]) => {
          const current = (await readFinal<Record<string, O>>(keyFor(m))) ?? {};
          let changed = false;
          for (const { id, odds } of list) {
            if (!(id in current)) {
              current[id] = odds;
              changed = true;
            }
          }
          if (changed) await writeFinal(keyFor(m), { ...current });
        }),
      );
    },
  };
}
