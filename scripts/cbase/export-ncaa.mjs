#!/usr/bin/env node
/**
 * NCAA Division I baseball results from the NCAA's scoreboard feed (data.ncaa.com, the feed behind
 * ncaa.com's scoreboard): every game of a season with date, teams, conferences, score and the NCAA game
 * id. ESPN lists only about a third of college baseball games, so ratings are built from this.
 * Days the old JSON feed doesn't have (all of 2026, some 2025 postseason days) come from the newer
 * GraphQL feed behind ncaa.com (sdataprod.ncaa.com, seasonYear = the academic year's start).
 *
 *   node scripts/cbase/export-ncaa.mjs 2025 out   → out/ncaa/2025.jsonl.gz
 * Row: { id, date, start, state, home: { seo, short, full, conf, score, winner, rank }, away: {...}, url }
 * ESPN's college baseball teams (out/espn-teams.json) come from scripts/cbase/espn-teams.mjs, for matching
 * ESPN's lines to these games.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const HEADERS = { "User-Agent": "Mozilla/5.0 (gamblingnfl research)", Accept: "application/json" };
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const side = (s) => ({
  seo: s?.names?.seo ?? "",
  short: s?.names?.short ?? "",
  full: s?.names?.full ?? "",
  conf: s?.conferences?.[0]?.conferenceSeo ?? "",
  score: s?.score === "" || s?.score == null ? null : Number(s.score),
  winner: s?.winner === true || s?.winner === "true",
  rank: s?.rank ?? "",
});

const GQL_HASH = "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";
const gqlUrl = (d) => {
  const [y, m, dd] = d.split("-");
  return `https://sdataprod.ncaa.com/?meta=GetContests_web&extensions=${encodeURIComponent(
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: GQL_HASH } }),
  )}&variables=${encodeURIComponent(
    JSON.stringify({
      sportCode: "MBA",
      division: 1,
      seasonYear: Number(y) - 1,
      contestDate: `${m}/${dd}/${y}`,
      week: null,
    }),
  )}`;
};
const gqlSide = (t) => ({
  seo: t?.seoname ?? "",
  short: t?.nameShort ?? "",
  full: t?.nameShort ?? "",
  conf: t?.conferenceSeo ?? "",
  score: t?.score == null ? null : Number(t.score),
  winner: t?.isWinner === true,
  rank: t?.teamRank ?? "",
});
let fromGql = 0;

const days = [];
for (
  let t = Date.UTC(YEAR, 1, 10);
  t <= Math.min(Date.UTC(YEAR, 6, 1), Date.now());
  t += 86_400_000
)
  days.push(new Date(t).toISOString().slice(0, 10));
const rows = new Map();
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < days.length) {
      const d = days[next++];
      const j = await get(
        `https://data.ncaa.com/casablanca/scoreboard/baseball/d1/${d.replace(/-/g, "/")}/scoreboard.json`,
      );
      if (!j) {
        const q = await get(gqlUrl(d));
        for (const c of q?.data?.contests ?? []) {
          const id = String(c.contestId ?? c.url ?? "");
          const home = c.teams?.find((t) => t.isHome);
          const away = c.teams?.find((t) => !t.isHome);
          if (!id || !home || !away || rows.has(`${d}|${id}`)) continue;
          fromGql += 1;
          rows.set(`${d}|${id}`, {
            id,
            date: d,
            start: c.startTime ?? "",
            epoch: c.startTimeEpoch ? Number(c.startTimeEpoch) : null,
            state: c.gameState === "F" ? "final" : (c.statusCodeDisplay ?? ""),
            final: c.finalMessage ?? "",
            home: gqlSide(home),
            away: gqlSide(away),
            url: c.url ?? "",
          });
        }
        continue;
      }
      for (const { game: g } of j?.games ?? []) {
        if (!g) continue;
        const id = String(g.gameID ?? g.url ?? "");
        if (!id || rows.has(`${d}|${id}`)) continue;
        rows.set(`${d}|${id}`, {
          id,
          date: d,
          start: g.startTime ?? "",
          epoch: g.startTimeEpoch ? Number(g.startTimeEpoch) : null,
          state: g.gameState ?? "",
          final: g.finalMessage ?? "",
          home: side(g.home),
          away: side(g.away),
          url: g.url ?? "",
        });
      }
    }
  }),
);
const list = [...rows.values()].sort(
  (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
);
await mkdir(join(OUT, "ncaa"), { recursive: true });
await writeFile(
  join(OUT, "ncaa", `${YEAR}.jsonl.gz`),
  gzipSync(list.map((r) => JSON.stringify(r)).join("\n") + "\n"),
);
const final = list.filter((r) => /final/i.test(r.state) && r.home.score != null);
console.log(
  `NCAA ${YEAR}: ${list.length} games, ${final.length} final (${fromGql} from the GraphQL feed)`,
);

// ESPN's team list (with logos): scripts/cbase/espn-teams.mjs
