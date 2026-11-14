#!/usr/bin/env node
/**
 * DraftKings over/under prices for every NFL player prop the site lists, from SportsGameOdds' free plan
 * (2,500 events a month; one game = one event, whatever the number of markets). ESPN shows DraftKings' prop
 * lines without prices; this fills them in. Same file format as odds-api-nfl.mjs, so the props board and the
 * graded history read both:
 *   <out>/<YYYY-MM-DDTHH>-sgo.json
 *   [{ home, away, commence, at, props: [[player, market, line, over, under]],
 *      alts: [[player, market, [[line, over price], ...]]],   (alts: BOOK's live alternate over lines)
 *      td: [[player, home|away, anytime, first, 2+, last]] }]  (BOOK's touchdown-scorer prices)
 * Only games that haven't kicked off (live lines are skipped). Keeps --keep events in reserve for the
 * other SportsGameOdds pulls (NHL periods, college basketball).
 *
 *   SPORTSGAMEODDS_API_KEY=... node scripts/line-history/sgo-nfl-props.mjs --out pull --hours 30 \
 *     [--also 2026-11-13T01:15:00Z,...]   (later kickoffs whose posted lines have no prices yet)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { booksOf } from "./sgo-games.mjs";
import { fullLineOf, marketsOf, periodPropsOf } from "./sgo-markets.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = opt("out", "pull");
const HOURS = Number(opt("hours", "30"));
// kickoff times (ISO, comma-separated) of later games whose lines are posted but not priced yet:
// pulled once now so the board has prices as soon as lines go up, not just on game day
const ALSO = (opt("also", "") || "").split(",").filter(Boolean);
const KEEP = Number(opt("keep", "400"));
const BOOK = opt("book", "draftkings");
// every book's main spread and total from the same events (line shopping; costs nothing extra)
const BEST = opt("best", "best-lines/nfl.json");
// every other priced market (halves, quarters, team totals, specials) and player 1st-half / quarter props
const MARKETS_OUT = opt("markets", "markets/nfl.json");
// games in progress: their closing lines and prices (SportsGameOdds keeps each prop's close, averaged
// across books, after kickoff), for props whose DraftKings price wasn't saved before kickoff
const LIVE = args.includes("--live");
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

// SportsGameOdds stat id → the site's market label (scripts/line-history/build-props-site.mjs)
export const STATS = {
  passing_yards: "Pass yds",
  passing_attempts: "Pass att",
  passing_completions: "Completions",
  passing_touchdowns: "Pass TDs",
  passing_interceptions: "Interceptions",
  rushing_yards: "Rush yds",
  rushing_attempts: "Carries",
  receiving_yards: "Rec yds",
  receiving_receptions: "Receptions",
  "rushing+receiving_yards": "Rush+Rec yds",
  "passing+rushing_yards": "Pass+Rush yds",
  // kickers and sacks (DraftKings prices sacks as over only); tackles aren't priced there
  kicking_totalPoints: "Kicking pts",
  fieldGoals_made: "FGs made",
  extraPoints_kicksMade: "XPs made",
  defense_sacks: "Sacks",
  // tackles and longest rush: DraftKings posts these on game day
  defense_soloTackles: "Tackles",
  defense_combinedTackles: "Tackles+Ast",
  defense_assistedTackles: "Tackle ast",
  rushing_longestRush: "Longest rush",
  // DraftKings prices longest reception on SportsGameOdds (longest rush and tackles it doesn't)
  receiving_longestReception: "Longest rec",
  // not on ESPN's DraftKings feed: added to the board from these pulls (build-upcoming.mjs)
  passing_longestCompletion: "Longest comp",
};

/**
 * 1st-half and quarter props (not on ESPN's feed; added to the board from these pulls, graded from the
 * play-by-play): SportsGameOdds period → label prefix, and the stats offered for them.
 */
export const PERIOD_PREFIX = { "1h": "1H", "1q": "1Q", "2q": "2Q", "3q": "3Q", "4q": "4Q" };
const PERIOD_STATS = new Set([
  "passing_yards",
  "passing_attempts",
  "passing_completions",
  "passing_touchdowns",
  "passing_interceptions",
  "rushing_yards",
  "rushing_attempts",
  "receiving_yards",
  "receiving_receptions",
  "rushing+receiving_yards",
  "passing+rushing_yards",
]);

/** The site label for an odds entry: full-game props, plus "1H Rec yds"-style period props. */
export function labelOf(m) {
  const base = STATS[m.statID];
  if (!base) return null;
  if (m.periodID === "game") return base;
  const pre = PERIOD_PREFIX[m.periodID];
  return pre && PERIOD_STATS.has(m.statID) ? `${pre} ${base}` : null;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Api-Key": KEY } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function monthUsage() {
  const m = (await get("/account/usage/"))?.data?.rateLimits?.["per-month"] ?? {};
  const used = Number(m["current-entities"]);
  const max = Number(m["max-entities"]);
  return Number.isFinite(used) && Number.isFinite(max) ? { used, max } : null;
}

const num = (v) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

/** [[player, label, line, over, under]] from one event's odds, at BOOK's line and prices. */
export function propsOf(e, book = BOOK) {
  const pairs = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    const label = labelOf(m);
    if (!label || !m.playerID || m.betTypeID !== "ou" || m.started) continue;
    const b = m.byBookmaker?.[book];
    if (!b || b.available === false) continue;
    const line = num(b.overUnder);
    const price = num(b.odds);
    if (line == null || price == null) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const k = `${m.playerID}|${label}|${line}`;
    const row = pairs.get(k) ?? [name, label, line, null, null];
    if (m.sideID === "over") row[3] = price;
    else if (m.sideID === "under") row[4] = price;
    pairs.set(k, row);
  }
  return [...pairs.values()];
}

/**
 * The other big books (no offshore or regional books), in the order their prices fill a gap DraftKings
 * leaves, with the tag the site shows.
 */
export const OTHER_BOOKS = [
  ["fanduel", "FD"],
  ["betmgm", "MGM"],
  ["caesars", "CZR"],
  ["espnbet", "theScore"],
  ["fanatics", "FAN"],
  ["hardrockbet", "HR"],
  ["bet365", "365"],
];

/** Full book names for the best-price labels on the props board. */
export const BOOK_NAMES = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  espnbet: "theScore Bet",
  fanatics: "Fanatics",
  hardrockbet: "Hard Rock",
  bet365: "bet365",
};

/**
 * The best over and the best under price for every player prop line across the big books:
 * [[player, label, line, best over, its book, best under, its book]] (book names from BOOK_NAMES).
 */
export function bestPricesOf(e) {
  const pay = (p) => (p > 0 ? p / 100 : 100 / -p);
  const best = new Map();
  for (const book of Object.keys(BOOK_NAMES)) {
    for (const [name, label, line, o, u] of propsOf(e, book)) {
      const k = `${name}|${label}|${line}`;
      const row = best.get(k) ?? [name, label, line, null, null, null, null];
      if (o != null && (row[3] == null || pay(o) > pay(row[3]))) [row[3], row[4]] = [o, BOOK_NAMES[book]];
      if (u != null && (row[5] == null || pay(u) > pay(row[5]))) [row[5], row[6]] = [u, BOOK_NAMES[book]];
      best.set(k, row);
    }
  }
  return [...best.values()];
}

/**
 * Other books' over/under prices for the player props BOOK doesn't price at all (any line):
 * [[player, label, line, over, under, book tag]], one per player / market / line, best-ranked book first.
 * Only lines with both sides priced.
 */
export function otherPropsOf(e, book = BOOK) {
  const have = new Set(
    propsOf(e, book)
      .filter((r) => r[3] != null && r[4] != null)
      .map((r) => `${r[0]}|${r[1]}`),
  );
  const out = new Map();
  for (const [b, tag] of OTHER_BOOKS) {
    for (const r of propsOf(e, b)) {
      if (r[3] == null || r[4] == null || have.has(`${r[0]}|${r[1]}`)) continue;
      const k = `${r[0]}|${r[1]}|${r[2]}`;
      if (!out.has(k)) out.set(k, [...r, tag]);
    }
  }
  return [...out.values()];
}

/**
 * A started game's closing lines: [[player, label, line, over, under, "CLOSE"]] from SportsGameOdds' close
 * (averaged across books), for every over/under prop with both sides.
 */
export function closeOf(e) {
  const pairs = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    const label = STATS[m.statID];
    if (!label || !m.playerID || m.periodID !== "game" || m.betTypeID !== "ou") continue;
    const line = num(m.closeBookOverUnder);
    const price = num(m.closeBookOdds);
    if (line == null || price == null) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const k = `${m.playerID}|${label}|${line}`;
    const row = pairs.get(k) ?? [name, label, line, null, null, "CLOSE"];
    if (m.sideID === "over") row[3] = price;
    else if (m.sideID === "under") row[4] = price;
    pairs.set(k, row);
  }
  return [...pairs.values()].filter((r) => r[3] != null && r[4] != null);
}

/** [[player, label, [[line, over price], ...]]]: BOOK's live alternate over lines (the "X+ yards" ladder). */
export function altsOf(e, book = BOOK) {
  const out = [];
  for (const m of Object.values(e.odds ?? {})) {
    const label = STATS[m.statID];
    if (!label || !m.playerID || m.periodID !== "game" || m.betTypeID !== "ou" || m.started)
      continue;
    if (m.sideID !== "over") continue;
    const b = m.byBookmaker?.[book];
    const main = num(b?.overUnder);
    const ladder = new Map();
    for (const a of b?.altLines ?? []) {
      if (a.available === false) continue;
      const line = num(a.overUnder);
      const price = num(a.odds);
      if (line == null || price == null || line === main) continue;
      ladder.set(line, price);
    }
    if (ladder.size < 2) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (name) out.push([name, label, [...ladder].sort((x, y) => x[0] - y[0])]);
  }
  return out;
}

/** Each player's side ("home" / "away") by name, for the props only these pulls carry. */
export function sidesOf(e) {
  const out = {};
  for (const p of Object.values(e.players ?? {})) {
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    const side =
      p?.teamID && p.teamID === e.teams?.home?.teamID
        ? "home"
        : p?.teamID && p.teamID === e.teams?.away?.teamID
          ? "away"
          : "";
    if (name && side) out[name] = side;
  }
  return out;
}

/**
 * The best anytime-touchdown price per player across DraftKings and the other books:
 * [[player, home|away, price, book tag]].
 */
export function tdBestOf(e) {
  const best = new Map();
  const tags = [[BOOK, "DK"], ...OTHER_BOOKS];
  for (const m of Object.values(e.odds ?? {})) {
    if (!m?.playerID || m.periodID !== "game" || m.started) continue;
    if (m.statID !== "touchdowns" || m.betTypeID !== "yn" || m.sideID !== "yes") continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    for (const [book, tag] of tags) {
      const b = m.byBookmaker?.[book];
      if (!b || b.available === false) continue;
      const price = num(b.odds);
      if (price == null) continue;
      const pay = price > 0 ? price / 100 : 100 / -price;
      const cur = best.get(name);
      if (!cur || pay > cur.pay) best.set(name, { pay, price, tag });
    }
  }
  const sides = sidesOf(e);
  return [...best].map(([n, b]) => [n, sides[n] ?? "", b.price, b.tag]);
}

/**
 * BOOK's touchdown-scorer prices for one event: [[player, home|away, anytime, first TD, 2+ TDs, last TD]].
 * SportsGameOdds: anytime = touchdowns yes, 2+ = touchdowns over 1.5, first / last = firstTouchdown /
 * lastTouchdown yes (full game only).
 */
export function tdOf(e, book = BOOK) {
  const rows = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    if (!m?.playerID || m.periodID !== "game" || m.started) continue;
    const b = m.byBookmaker?.[book];
    if (!b || b.available === false) continue;
    const price = num(b.odds);
    if (price == null) continue;
    let col = -1;
    if (m.statID === "touchdowns" && m.betTypeID === "yn" && m.sideID === "yes") col = 2;
    else if (m.statID === "firstTouchdown" && m.betTypeID === "yn" && m.sideID === "yes") col = 3;
    else if (
      m.statID === "touchdowns" &&
      m.betTypeID === "ou" &&
      m.sideID === "over" &&
      num(b.overUnder) === 1.5
    )
      col = 4;
    else if (m.statID === "lastTouchdown" && m.betTypeID === "yn" && m.sideID === "yes") col = 5;
    if (col < 0) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const side =
      p?.teamID && p.teamID === e.teams?.home?.teamID
        ? "home"
        : p?.teamID === e.teams?.away?.teamID
          ? "away"
          : "";
    const row = rows.get(m.playerID) ?? [name, side, null, null, null, null];
    row[col] = price;
    rows.set(m.playerID, row);
  }
  // most likely scorers first
  return [...rows.values()].sort((a, b) => (a[2] ?? 99999) - (b[2] ?? 99999));
}

async function main() {
  if (!KEY) {
    console.log("SPORTSGAMEODDS_API_KEY is not set; nothing to do.");
    return;
  }
  const usage = await monthUsage().catch(() => null);
  let left = usage ? usage.max - usage.used : null;
  console.log(`month usage: ${usage ? `${usage.used}/${usage.max}` : "?"}`);
  const now = Date.now();
  const games = [];
  const lines = [];
  const markets = [];
  const seen = new Set();
  const windows = LIVE ? [[null, null]] : [[now, now + HOURS * 3_600_000]];
  for (const t of ALSO) {
    const k = Date.parse(t);
    if (Number.isFinite(k) && k > now + HOURS * 3_600_000) windows.push([k - 60_000, k + 60_000]);
  }
  for (const [after, before] of windows) {
    let cursor = "";
    for (let page = 0; page < 4; page += 1) {
      // each event returned costs one; stop short of the reserve
      const room = left == null ? 20 : Math.min(20, left - KEEP);
      if (room <= 0) {
        console.log(`stopping: ${left} events left this month (keeping ${KEEP})`);
        break;
      }
      const q = new URLSearchParams(
        LIVE
          ? { leagueID: "NFL", live: "true", limit: String(room) }
          : {
              leagueID: "NFL",
              oddsAvailable: "true",
              startsAfter: new Date(after).toISOString(),
              startsBefore: new Date(before).toISOString(),
              limit: String(room),
              includeAltLines: "true",
            },
      );
      if (cursor) q.set("cursor", cursor);
      const r = await get(`/events/?${q}`);
      const data = r?.data ?? [];
      if (left != null) left -= data.length;
      for (const e of data) {
        if (seen.has(e.eventID)) continue;
        seen.add(e.eventID);
        const name = (t) => t?.names?.long ?? t?.names?.medium ?? t?.teamID ?? "";
        // a game in progress: only its closing lines (the books' current prices are in-game ones)
        const props = LIVE ? [] : propsOf(e);
        const alts = LIVE ? [] : altsOf(e);
        const td = LIVE ? [] : tdOf(e);
        const others = LIVE ? closeOf(e) : otherPropsOf(e);
        const tdb = LIVE ? [] : tdBestOf(e);
        const bp = LIVE ? [] : bestPricesOf(e);
        const sides = LIVE ? {} : sidesOf(e);
        const g = {
          home: name(e.teams?.home),
          away: name(e.teams?.away),
          commence: e.status?.startsAt,
        };
        console.log(
          `${g.away} @ ${g.home}: ${props.length} priced lines, ${alts.length} ladders, ${td.length} TD scorers, ${others.length} other-book lines`,
        );
        if (props.length || td.length || others.length)
          games.push({ ...g, at: new Date().toISOString(), props, alts, td, others, tdb, sides, bp });
        const books = LIVE ? [] : booksOf(e);
        if (books.length) lines.push({ ...g, books });
        const mk = LIVE ? [] : marketsOf(e);
        const pp = LIVE ? [] : periodPropsOf(e);
        if (mk.length || pp.length) markets.push({ ...g, full: fullLineOf(books), mk, pp });
      }
      cursor = r?.nextCursor ?? "";
      if (!cursor) break;
    }
  }
  if (lines.length) {
    await mkdir(dirname(BEST), { recursive: true });
    await writeFile(
      BEST,
      JSON.stringify({ at: new Date().toISOString(), source: "sgo", league: "NFL", games: lines }),
    );
    console.log(`line shopping: ${lines.length} games, every book's lines → ${BEST}`);
  }
  if (markets.length) {
    await mkdir(dirname(MARKETS_OUT), { recursive: true });
    await writeFile(
      MARKETS_OUT,
      JSON.stringify({
        at: new Date().toISOString(),
        source: "sgo",
        league: "NFL",
        games: markets,
      }),
    );
    console.log(`more markets: ${markets.length} games → ${MARKETS_OUT}`);
  }
  if (!games.length) {
    console.log("nothing priced");
    return;
  }
  await mkdir(OUT, { recursive: true });
  const file = join(
    OUT,
    `${new Date().toISOString().slice(0, 13)}-sgo${LIVE ? "-close" : ""}.json`,
  );
  await writeFile(file, JSON.stringify(games));
  console.log(`saved ${games.length} games to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
