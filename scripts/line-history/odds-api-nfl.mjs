#!/usr/bin/env node
/**
 * DraftKings over/under prices for NFL player props from The Odds API (free plan: 500 credits a month).
 * ESPN shows DraftKings' NFL prop lines but not their prices; this fills the prices in.
 *
 * One pull = 6 markets × 1 region = 6 credits per game. The events list is free.
 *   <out>/<YYYY-MM-DDTHH>.json  [{ home, away, commence, at, props: [[player, market, line, over, under]] }]
 *
 *   ODDS_API_KEY=... node scripts/line-history/odds-api-nfl.mjs --out props-site/nfl/odds-api --hours 60
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = opt("out", "props-site/nfl/odds-api");
const HOURS = Number(opt("hours", "60"));
const KEEP = Number(opt("keep", "60")); // stop if the month's remaining credits would drop below this
const KEY = process.env.ODDS_API_KEY;
const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";

export const MARKETS = {
  player_pass_yds: "Pass yds",
  player_pass_attempts: "Pass att",
  player_pass_completions: "Completions",
  player_rush_yds: "Rush yds",
  player_reception_yds: "Rec yds",
  player_receptions: "Receptions",
};
const COST = Object.keys(MARKETS).length;

async function get(path, params = {}) {
  const q = new URLSearchParams({ apiKey: KEY, ...params });
  const res = await fetch(`${BASE}${path}?${q}`);
  const left = Number(res.headers.get("x-requests-remaining"));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return { body: await res.json(), left: Number.isFinite(left) ? left : null };
}

async function main() {
  if (!KEY) {
    console.log("ODDS_API_KEY is not set; nothing to do.");
    return;
  }
  const now = Date.now();
  const { body: events, left: start } = await get("/events");
  const soon = events
    .filter((e) => {
      const t = Date.parse(e.commence_time);
      return t > now && t <= now + HOURS * 3_600_000;
    })
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  console.log(`${soon.length} games in the next ${HOURS}h; ${start ?? "?"} credits left this month`);
  let left = start;
  const games = [];
  for (const e of soon) {
    if (left != null && left - COST < KEEP) {
      console.log(`stopping: ${left} credits left`);
      break;
    }
    const r = await get(`/events/${e.id}/odds`, {
      regions: "us",
      bookmakers: "draftkings",
      markets: Object.keys(MARKETS).join(","),
      oddsFormat: "american",
    });
    left = r.left ?? left;
    const book = r.body.bookmakers?.find((b) => b.key === "draftkings");
    const pairs = new Map();
    for (const m of book?.markets ?? []) {
      const label = MARKETS[m.key];
      if (!label) continue;
      for (const o of m.outcomes ?? []) {
        if (!o.description || o.point == null) continue;
        const k = `${o.description}|${label}|${o.point}`;
        const p = pairs.get(k) ?? [o.description, label, o.point, null, null];
        if (o.name === "Over") p[3] = o.price;
        else if (o.name === "Under") p[4] = o.price;
        pairs.set(k, p);
      }
    }
    const props = [...pairs.values()].filter((p) => p[3] != null || p[4] != null);
    games.push({ home: e.home_team, away: e.away_team, commence: e.commence_time, at: new Date().toISOString(), props });
    console.log(`${e.away_team} @ ${e.home_team}: ${props.length} lines (${left ?? "?"} credits left)`);
  }
  if (!games.length) return;
  await mkdir(OUT, { recursive: true });
  const name = new Date().toISOString().slice(0, 13);
  await writeFile(join(OUT, `${name}.json`), JSON.stringify(games));
  console.log(`saved ${games.length} games to ${join(OUT, `${name}.json`)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
