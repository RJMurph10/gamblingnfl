#!/usr/bin/env node
/**
 * SportsGameOdds probe: which leagues this key can use, account usage, and a few sample events with odds
 * per basketball league (limit 5 each, to save the monthly allowance). Writes <out>/sgo-probe.json.
 *   SPORTSGAMEODDS_API_KEY=... node scripts/line-history/sgo-probe.mjs --out pull
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "pull";
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Api-Key": KEY } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body };
}

const out = { at: new Date().toISOString() };
if (!KEY) {
  console.log("SPORTSGAMEODDS_API_KEY not set");
  process.exit(0);
}
out.usage = await get("/account/usage/");
const leagues = await get("/leagues/");
out.leaguesStatus = leagues.status;
out.leagues = (leagues.body?.data ?? []).map((l) => ({ id: l.leagueID, sport: l.sportID, name: l.name, enabled: l.enabled }));
out.samples = {};
for (const lg of ["NCAAB", "NCAAW", "WNCAAB", "NCAAWB"]) {
  const r = await get(`/events/?leagueID=${lg}&oddsAvailable=true&limit=5`);
  const evs = Array.isArray(r.body?.data) ? r.body.data : [];
  out.samples[lg] = {
    status: r.status,
    error: r.status === 200 ? undefined : r.body,
    count: evs.length,
    events: evs.map((e) => ({
      id: e.eventID,
      starts: e.status?.startsAt,
      home: e.teams?.home?.names?.long ?? e.teams?.home?.teamID,
      away: e.teams?.away?.names?.long ?? e.teams?.away?.teamID,
      oddsKeys: Object.keys(e.odds ?? {}).filter((k) => /game-ou|game-sp|points-all-game|points-home-game-sp|points-away-game-sp/.test(k)).slice(0, 6),
      sample: Object.fromEntries(
        Object.entries(e.odds ?? {})
          .filter(([k]) => /^points-all-game-ou-over$|^points-home-game-sp-home$/.test(k))
          .map(([k, v]) => [k, { line: v.bookOverUnder ?? v.bookSpread ?? v.fairOverUnder ?? v.fairSpread, books: Object.keys(v.byBookmaker ?? {}) }]),
      ),
    })),
  };
}
out.usageAfter = await get("/account/usage/");
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "sgo-probe.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ leagues: out.leagues.length, samples: Object.fromEntries(Object.entries(out.samples).map(([k, v]) => [k, v.count])) }));
