#!/usr/bin/env node
/**
 * Game lines from SportsGameOdds (free plan: 8 leagues, 2,500 events a month) for the next ~30 hours of one
 * league, every listed book. Saved in the shared extra-lines snapshot format (scripts/cbb/extra-lines.mjs):
 *   <out>/<YYYY-MM-DDTHH>.json  { at, source: "sgo", league, games: [{ home, away, commence, books: [...] }] }
 * Stops before the month's event allowance would run out (keeps --keep events in reserve).
 *
 *   SPORTSGAMEODDS_API_KEY=... node scripts/line-history/sgo-games.mjs --league NCAAB --out pull/sgo/cbb
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const LEAGUE = opt("league", "NCAAB");
const OUT = opt("out", "pull/sgo/cbb");
const HOURS = Number(opt("hours", "30"));
const KEEP = Number(opt("keep", "150"));
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Api-Key": KEY } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** This month's events used and allowed, from /account/usage (null when the response doesn't say). */
async function monthUsage() {
  const u = (await get("/account/usage/"))?.data ?? {};
  const limits = u.rateLimits ?? {};
  const month = Object.entries(limits).find(([k]) => /month/i.test(k))?.[1];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return month ? { used: num(month["current-entities"]), max: num(month["max-entities"]) } : null;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Every listed book's main spread / total / moneyline for one SportsGameOdds event. */
export function booksOf(e) {
  const o = e.odds ?? {};
  const by = (k) => o[k]?.byBookmaker ?? {};
  const keys = new Set([
    ...Object.keys(by("points-home-game-sp-home")),
    ...Object.keys(by("points-all-game-ou-over")),
    ...Object.keys(by("points-home-game-ml-home")),
  ]);
  const books = [];
  for (const k of keys) {
    const sh = by("points-home-game-sp-home")[k];
    const sa = by("points-away-game-sp-away")[k];
    const ov = by("points-all-game-ou-over")[k];
    const un = by("points-all-game-ou-under")[k];
    const mh = by("points-home-game-ml-home")[k];
    const ma = by("points-away-game-ml-away")[k];
    const live = (x) => x && x.available !== false;
    books.push({
      key: k,
      spread: live(sh) && num(sh.spread) != null ? [num(sh.spread), num(sh.odds), num(sa?.odds)] : null,
      total: live(ov) && num(ov.overUnder) != null ? [num(ov.overUnder), num(ov.odds), num(un?.odds)] : null,
      ml: live(mh) || live(ma) ? [num(mh?.odds), num(ma?.odds)] : null,
    });
  }
  // the consensus line when no single book is listed
  if (!books.some((b) => b.spread || b.total)) {
    const sp = num(o["points-home-game-sp-home"]?.bookSpread);
    const tot = num(o["points-all-game-ou-over"]?.bookOverUnder);
    if (sp != null || tot != null) books.push({ key: "consensus", spread: sp != null ? [sp, null, null] : null, total: tot != null ? [tot, null, null] : null, ml: null });
  }
  return books;
}

async function main() {
  if (!KEY) {
    console.log("SPORTSGAMEODDS_API_KEY is not set; nothing to do.");
    return;
  }
  const usage = await monthUsage().catch(() => null);
  if (usage?.used != null && usage?.max != null && usage.max - usage.used < KEEP) {
    console.log(`only ${usage.max - usage.used} events left this month; skipping`);
    return;
  }
  const now = Date.now();
  const games = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const q = new URLSearchParams({
      leagueID: LEAGUE,
      oddsAvailable: "true",
      startsAfter: new Date(now).toISOString(),
      startsBefore: new Date(now + HOURS * 3_600_000).toISOString(),
      limit: "100",
    });
    if (cursor) q.set("cursor", cursor);
    const r = await get(`/events/?${q}`);
    for (const e of r?.data ?? []) {
      const name = (t) => t?.names?.long ?? t?.names?.medium ?? t?.teamID ?? "";
      const books = booksOf(e);
      if (books.length) games.push({ home: name(e.teams?.home), away: name(e.teams?.away), commence: e.status?.startsAt, books });
    }
    cursor = r?.nextCursor ?? "";
    if (!cursor) break;
  }
  const at = new Date().toISOString();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `${at.slice(0, 13)}.json`), JSON.stringify({ at, source: "sgo", league: LEAGUE, usage, games }));
  console.log(`${LEAGUE}: ${games.length} games with lines; month usage before: ${usage ? `${usage.used}/${usage.max}` : "?"}`);
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
