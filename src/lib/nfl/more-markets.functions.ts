import { createServerFn } from "@tanstack/react-start";
import { cached, clearCached } from "@/lib/shared/espn-core.server";
import { z } from "zod";
import { nameMatch } from "@/lib/shared/best-lines";
import type { LineGame, LineIndexRow, MarketsFile, PartialsFile } from "@/lib/nfl/more-markets";

const RAW = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site";

/**
 * cached(), but a missing file isn't kept: it's asked for again after a minute (a file published moments
 * after a visit would otherwise stay "missing" for the whole cache time).
 */
const missedAt = new Map<string, number>();
async function cachedFile<T>(key: string, url: string, ttl: number): Promise<T | null> {
  const miss = missedAt.get(key);
  if (miss && Date.now() - miss < 60_000) return null;
  const v = await cached(key, () => json<T>(url), ttl);
  if (v == null) {
    missedAt.set(key, Date.now());
    clearCached(key);
  } else missedAt.delete(key);
  return v;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Every book's halves, quarters, team totals, specials and player period props for upcoming NFL games. */
export const getNflMoreMarkets = createServerFn({ method: "GET" }).handler(async () =>
  cached("nfl-more-markets", () => json<MarketsFile>(`${RAW}/markets/nfl.json`), 10 * 60_000),
);

/** The quarter / half edge finder's flags and record this season. */
export const getNflPartials = createServerFn({ method: "GET" }).handler(async () => {
  const now = new Date();
  const season = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return cached(
    `nfl-partials-${season}`,
    () => json<PartialsFile>(`${RAW}/nfl/partials-${season}.json`),
    10 * 60_000,
  );
});

/**
 * One game's saved lines (every book's full-game, half, quarter, team-total and special markets; the last
 * pull before kickoff and the first), matched by team names and kickoff; null when none were saved.
 */
export const getNflLineGame = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z.object({ home: z.string(), away: z.string(), when: z.string() }).parse(data),
  )
  .handler(async ({ data }) => {
    const index = await cached(
      "nfl-lines-index",
      () => json<LineIndexRow[]>(`${RAW}/markets/nfl/index.json`),
      10 * 60_000,
    );
    const t = Date.parse(data.when);
    // the closest names among games within 6 hours (New York Jets / Giants share two of three words)
    let row: LineIndexRow | null = null;
    let best = 0;
    for (const r of index ?? []) {
      if (Math.abs(Date.parse(r.commence) - t) > 6 * 3_600_000) continue;
      const score = Math.min(nameMatch(r.home, data.home), nameMatch(r.away, data.away));
      if (score >= 0.6 && score > best) {
        row = r;
        best = score;
      }
    }
    if (!row) return null;
    // a game that has started keeps its lines; an upcoming one refreshes with each pull
    const ttl = Date.parse(row.commence) < Date.now() ? 60 * 60_000 : 10 * 60_000;
    return cached(
      `nfl-lines-${row.f}`,
      () => json<LineGame>(`${RAW}/markets/nfl/games/${row.f}`),
      ttl,
    );
  });
