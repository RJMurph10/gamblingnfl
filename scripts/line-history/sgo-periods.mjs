#!/usr/bin/env node
/**
 * Period and full-game lines with prices from SportsGameOdds (free plan), for building period models: every
 * listed book's line and price for the full game and each period (NHL 1st / 2nd / 3rd period, regulation), plus
 * SportsGameOdds' opening line and price for each market when it reports them. Pulled a few times a day, so the
 * snapshots together keep the opener and how the line moved.
 *   <out>/<YYYY-MM-DDTHH>.json
 *   { at, source: "sgo", league, usage, games: [{ id, home, away, commence,
 *       markets: { <oddID>: { open: [line, price] | null, books: { <book>: [line, price, lastUpdatedAt] } } } }] }
 *   oddID = <stat>-<side>-<period>-<bet>-<pick>, e.g. points-all-1p-ou-over (1st-period total, over),
 *   points-home-1p-sp-home (1st-period spread, home), points-home-game-ml-home.
 * Stops before the month's event allowance would run out (keeps --keep events in reserve).
 *
 *   SPORTSGAMEODDS_API_KEY=... node scripts/line-history/sgo-periods.mjs --league NHL --out pull/sgo-periods/nhl
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const LEAGUE = opt("league", "NHL");
const OUT = opt("out", "pull/sgo-periods/nhl");
const HOURS = Number(opt("hours", "20"));
const KEEP = Number(opt("keep", "150"));
// which periods to keep (SportsGameOdds period ids)
const PERIODS = new Set(opt("periods", "game,reg,1p,2p,3p").split(","));
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Api-Key": KEY } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function monthUsage() {
  const u = (await get("/account/usage/"))?.data ?? {};
  const limits = u.rateLimits ?? {};
  const month = Object.entries(limits).find(([k]) => /month/i.test(k))?.[1];
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return month ? { used: n(month["current-entities"]), max: n(month["max-entities"]) } : null;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** the line of a market entry: total for over/under, spread for spreads, none for moneylines */
const lineOf = (x, pre = "") => num(x?.[`${pre}overUnder`] ?? x?.[`${pre}OverUnder`] ?? x?.[`${pre}spread`] ?? x?.[`${pre}Spread`]);

function marketsOf(e) {
  const out = {};
  for (const [oddID, m] of Object.entries(e.odds ?? {})) {
    const parts = oddID.split("-");
    if (parts[0] !== "points" || !PERIODS.has(parts[2]) || !["ou", "sp", "ml"].includes(parts[3])) continue;
    const books = {};
    for (const [book, b] of Object.entries(m?.byBookmaker ?? {})) {
      if (b?.available === false) continue;
      books[book] = [lineOf(b), num(b?.odds), b?.lastUpdatedAt ?? null];
    }
    // SportsGameOdds' own opening line / price for the market, when it reports one
    const openLine = num(m?.openBookOverUnder ?? m?.openBookSpread);
    const openPrice = num(m?.openBookOdds);
    const open = openLine != null || openPrice != null ? [openLine, openPrice] : null;
    if (Object.keys(books).length || open) out[oddID] = { open, books };
  }
  return out;
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
  for (let page = 0; page < 5; page += 1) {
    const q = new URLSearchParams({
      leagueID: LEAGUE,
      oddsAvailable: "true",
      startsAfter: new Date(now).toISOString(),
      startsBefore: new Date(now + HOURS * 3_600_000).toISOString(),
      limit: "50",
    });
    if (cursor) q.set("cursor", cursor);
    const r = await get(`/events/?${q}`);
    for (const e of r?.data ?? []) {
      const name = (t) => t?.names?.long ?? t?.names?.medium ?? t?.teamID ?? "";
      const markets = marketsOf(e);
      if (Object.keys(markets).length)
        games.push({ id: e.eventID ?? null, home: name(e.teams?.home), away: name(e.teams?.away), commence: e.status?.startsAt, markets });
    }
    cursor = r?.nextCursor ?? "";
    if (!cursor) break;
  }
  const at = new Date().toISOString();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `${at.slice(0, 13)}.json`), JSON.stringify({ at, source: "sgo", league: LEAGUE, usage, games }));
  const p1 = games.filter((g) => Object.keys(g.markets).some((k) => k.startsWith("points-all-1p-ou"))).length;
  const books = new Set(games.flatMap((g) => Object.values(g.markets).flatMap((m) => Object.keys(m.books))));
  console.log(
    `${LEAGUE}: ${games.length} games, ${p1} with a 1st-period total; books: ${[...books].join(", ") || "none"}; ` +
      `month usage before: ${usage ? `${usage.used}/${usage.max}` : "?"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
