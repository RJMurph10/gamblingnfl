import { createServerFn } from "@tanstack/react-start";
import { cached } from "@/lib/shared/espn-core.server";
import type { MarketsFile, PartialsFile } from "@/lib/nfl/more-markets";

const RAW = "https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site";

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
