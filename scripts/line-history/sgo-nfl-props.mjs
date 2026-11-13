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
  // DraftKings prices longest reception on SportsGameOdds (longest rush and tackles it doesn't)
  receiving_longestReception: "Longest rec",
};

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
    const label = STATS[m.statID];
    if (!label || !m.playerID || m.periodID !== "game" || m.betTypeID !== "ou" || m.started)
      continue;
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

/** Other books, in the order their prices fill a gap DraftKings leaves, with the tag the site shows. */
export const OTHER_BOOKS = [
  ["fanduel", "FD"],
  ["betmgm", "MGM"],
  ["caesars", "CZR"],
  ["espnbet", "ESPN BET"],
  ["fanatics", "FAN"],
  ["bovada", "BOV"],
];

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
    else if (m.statID === "touchdowns" && m.betTypeID === "ou" && m.sideID === "over" && num(b.overUnder) === 1.5)
      col = 4;
    else if (m.statID === "lastTouchdown" && m.betTypeID === "yn" && m.sideID === "yes") col = 5;
    if (col < 0) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const side =
      p?.teamID && p.teamID === e.teams?.home?.teamID ? "home" : p?.teamID === e.teams?.away?.teamID ? "away" : "";
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
  const seen = new Set();
  const windows = [[now, now + HOURS * 3_600_000]];
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
      const q = new URLSearchParams({
        leagueID: "NFL",
        oddsAvailable: "true",
        startsAfter: new Date(after).toISOString(),
        startsBefore: new Date(before).toISOString(),
        limit: String(room),
        includeAltLines: "true",
      });
      if (cursor) q.set("cursor", cursor);
      const r = await get(`/events/?${q}`);
      const data = r?.data ?? [];
      if (left != null) left -= data.length;
      for (const e of data) {
        if (seen.has(e.eventID)) continue;
        seen.add(e.eventID);
        const name = (t) => t?.names?.long ?? t?.names?.medium ?? t?.teamID ?? "";
        const props = propsOf(e);
        const alts = altsOf(e);
        const td = tdOf(e);
        const others = otherPropsOf(e);
        const g = {
          home: name(e.teams?.home),
          away: name(e.teams?.away),
          commence: e.status?.startsAt,
        };
        console.log(
          `${g.away} @ ${g.home}: ${props.length} priced lines, ${alts.length} ladders, ${td.length} TD scorers, ${others.length} other-book lines`,
        );
        if (props.length || td.length || others.length)
          games.push({ ...g, at: new Date().toISOString(), props, alts, td, others });
        const books = booksOf(e);
        if (books.length) lines.push({ ...g, books });
      }
      cursor = r?.nextCursor ?? "";
      if (!cursor) break;
    }
  }
  if (lines.length) {
    await mkdir(dirname(BEST), { recursive: true });
    await writeFile(BEST, JSON.stringify({ at: new Date().toISOString(), source: "sgo", league: "NFL", games: lines }));
    console.log(`line shopping: ${lines.length} games, every book's lines → ${BEST}`);
  }
  if (!games.length) {
    console.log("nothing priced");
    return;
  }
  await mkdir(OUT, { recursive: true });
  const file = join(OUT, `${new Date().toISOString().slice(0, 13)}-sgo.json`);
  await writeFile(file, JSON.stringify(games));
  console.log(`saved ${games.length} games to ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
