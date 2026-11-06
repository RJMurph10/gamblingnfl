#!/usr/bin/env node
/**
 * Game lines (spreads, totals, moneylines) for one sport from The Odds API, every listed book: one call
 * covers every upcoming and live game and costs 1 credit per market (spreads + totals = 2).
 *   <out>/<sport>/<YYYY-MM-DDTHH>.json  { at, sport, creditsLeft, games: [{ id, home, away, commence,
 *     books: [{ key, spread: [homePoint, homePrice, awayPrice] | null, total: [point, over, under] | null,
 *     ml: [home, away] | null }] }] }
 *
 *   ODDS_API_KEY=... node scripts/line-history/odds-api-games.mjs --sport basketball_wncaab --out props-site/odds-api
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const SPORT = opt("sport", "basketball_wncaab");
const OUT = opt("out", "props-site/odds-api");
const MARKETS = opt("markets", "spreads,totals");
const KEEP = Number(opt("keep", "40")); // don't run when fewer credits than this are left
const KEY = process.env.ODDS_API_KEY;

async function main() {
  if (!KEY) {
    console.log("ODDS_API_KEY is not set; nothing to do.");
    return;
  }
  // the sports list is free and reports the credits left
  const probe = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${KEY}`);
  const before = Number(probe.headers.get("x-requests-remaining"));
  const sports = probe.ok ? await probe.json() : [];
  const listed = sports.find((s) => s.key === SPORT);
  console.log(`${SPORT}: ${listed ? (listed.active ? "active" : "listed, not active") : "not listed"}; ${before} credits left`);
  if (Number.isFinite(before) && before - MARKETS.split(",").length < KEEP) {
    console.log(`only ${before} credits left; skipping`);
    return;
  }
  const q = new URLSearchParams({ apiKey: KEY, regions: "us", markets: MARKETS, oddsFormat: "american" });
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT}/odds?${q}`);
  const left = Number(res.headers.get("x-requests-remaining"));
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const games = body.map((g) => ({
    id: g.id,
    home: g.home_team,
    away: g.away_team,
    commence: g.commence_time,
    books: (g.bookmakers ?? []).map((b) => {
      const m = (k) => b.markets?.find((x) => x.key === k)?.outcomes ?? [];
      const sp = m("spreads");
      const tot = m("totals");
      const h2h = m("h2h");
      const side = (arr, name) => arr.find((o) => o.name === name);
      const hs = side(sp, g.home_team);
      const as = side(sp, g.away_team);
      const ov = side(tot, "Over");
      const un = side(tot, "Under");
      return {
        key: b.key,
        spread: hs ? [hs.point, hs.price, as?.price ?? null] : null,
        total: ov ? [ov.point, ov.price, un?.price ?? null] : null,
        ml: h2h.length ? [side(h2h, g.home_team)?.price ?? null, side(h2h, g.away_team)?.price ?? null] : null,
      };
    }),
  }));
  const at = new Date().toISOString();
  await mkdir(join(OUT, SPORT), { recursive: true });
  await writeFile(
    join(OUT, SPORT, `${at.slice(0, 13)}.json`),
    JSON.stringify({ at, sport: SPORT, creditsBefore: before, creditsLeft: Number.isFinite(left) ? left : null, games }),
  );
  console.log(`${games.length} games, ${games.filter((g) => g.books.length).length} with lines; ${left} credits left`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
