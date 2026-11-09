#!/usr/bin/env node
/**
 * DraftKings over/under prices for every NFL player prop the site lists, from SportsGameOdds' free plan
 * (2,500 events a month; one game = one event, whatever the number of markets). ESPN shows DraftKings' prop
 * lines without prices; this fills them in. Same file format as odds-api-nfl.mjs, so the props board and the
 * graded history read both:
 *   <out>/<YYYY-MM-DDTHH>-sgo.json
 *   [{ home, away, commence, at, props: [[player, market, line, over, under]],
 *      alts: [[player, market, [[line, over price], ...]]] }]   (alts: BOOK's live alternate over lines)
 * Only games that haven't kicked off (live lines are skipped). Keeps --keep events in reserve for the
 * other SportsGameOdds pulls (NHL periods, college basketball).
 *
 *   SPORTSGAMEODDS_API_KEY=... node scripts/line-history/sgo-nfl-props.mjs --out pull --hours 30 \
 *     [--also 2026-11-13T01:15:00Z,...]   (later kickoffs whose posted lines have no prices yet)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
        const g = {
          home: name(e.teams?.home),
          away: name(e.teams?.away),
          commence: e.status?.startsAt,
        };
        console.log(`${g.away} @ ${g.home}: ${props.length} priced lines, ${alts.length} ladders`);
        if (props.length) games.push({ ...g, at: new Date().toISOString(), props, alts });
      }
      cursor = r?.nextCursor ?? "";
      if (!cursor) break;
    }
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
