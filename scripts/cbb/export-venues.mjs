#!/usr/bin/env node
/**
 * Where every men's college basketball game was played, one season at a time, from ESPN's daily
 * scoreboard (one request per day): arena name, city, state/country and the neutral-site flag. Used to
 * measure travel distance in neutral-site games. Output goes to the cbb-history branch (venues/).
 *
 *   node scripts/cbb/export-venues.mjs 2025 out   → out/venues-2025-26.json
 *   [[gameId, date, homeId, awayId, neutral 0|1, venue, city, state, country]]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const LABEL = `${YEAR}-${String(YEAR + 1).slice(2)}`;
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const H = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  console.log(`failed: ${url}`);
  return null;
}

const rows = [];
const seen = new Set();
const start = Date.UTC(YEAR, 9, 25); // Oct 25
const end = Math.min(Date.UTC(YEAR + 1, 3, 15), Date.now()); // Apr 15
for (let t = start; t <= end; t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10).replaceAll("-", "");
  // groups=50 is Division I; limit covers the busiest days
  const sb = await get(`${SITE}/scoreboard?dates=${day}&groups=50&limit=500`);
  for (const e of sb?.events ?? []) {
    if (seen.has(e.id)) continue;
    const comp = e.competitions?.[0];
    if (!comp || comp.status?.type?.completed !== true) continue;
    const h = comp.competitors?.find((c) => c.homeAway === "home");
    const a = comp.competitors?.find((c) => c.homeAway === "away");
    if (!h?.team?.id || !a?.team?.id) continue;
    seen.add(e.id);
    const v = comp.venue ?? {};
    const addr = v.address ?? {};
    rows.push([
      String(e.id),
      String(e.date),
      String(h.team.id),
      String(a.team.id),
      comp.neutralSite ? 1 : 0,
      String(v.fullName ?? ""),
      String(addr.city ?? ""),
      String(addr.state ?? ""),
      String(addr.country ?? ""),
    ]);
  }
}
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, `venues-${LABEL}.json`), JSON.stringify(rows));
const withCity = rows.filter((r) => r[6]).length;
console.log(`${LABEL}: ${rows.length} games, ${withCity} with a city, ${rows.filter((r) => r[4]).length} neutral`);
