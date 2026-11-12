#!/usr/bin/env node
/**
 * The site's "Upcoming games" prop lines: from the hourly logger's game files (line-history branch),
 * every game that hasn't started, with each player's main line per market as of the newest snapshot
 * (closing → latest → opening), where it opened, and prices when posted.
 *   <out>/<league>/upcoming.json  [{ id, date, name, away, home, at, props: [[player, team, market, line, over, under, opened]] }]
 *
 *   node scripts/line-history/build-upcoming.mjs --data data --out props-site --league nba
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPrices } from "./odds-api-prices.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "data");
const OUT = opt("out", "props-site");
const NOW = Date.now();
const PRICES = opt("prices"); // saved Odds API pulls (NFL), to fill prices ESPN doesn't show
const AHEAD =(KEY === "nfl" || KEY === "cfb" ? 8 : 3) * 86_400_000;
/**
 * Leagues whose started and finished games also get their closing board, one file per game, for the
 * game page's Props tab: <out>/<league>/closed/<event id>.json. Rewritten while the game is recent
 * (a few days), written once for older games that don't have one yet.
 */
const CLOSED = new Set(["nfl", "nba", "nhl"]);
const RECENT = 5 * 86_400_000;

const LABELS =
  {
    nba: {
      "Total Points": "Points",
      "Total Rebounds": "Rebounds",
      "Total Assists": "Assists",
      "Total 3-Point Field Goals": "3-pointers",
      "Total Points, Rebounds, and Assists": "Pts+Reb+Ast",
      "Total Points and Rebounds": "Pts+Reb",
      "Total Points and Assists": "Pts+Ast",
      "Total Assists and Rebounds": "Reb+Ast",
      "Total Steals": "Steals",
      "Total Blocks": "Blocks",
      "Total Turnovers": "Turnovers",
    },
    nfl: {
      "Total Passing Yards (incl. overtime)": "Pass yds",
      "Total Passing Attempts (incl. overtime)": "Pass att",
      "Total Pass Completions (incl. overtime)": "Completions",
      "Total Passing Touchdowns (incl. overtime)": "Pass TDs",
      "Total Passing Interceptions (incl. overtime)": "Interceptions",
      "Total Rushing Yards (incl. overtime)": "Rush yds",
      "Total Carries (incl. overtime)": "Carries",
      "Total Receiving Yards (incl. overtime)": "Rec yds",
      "Total Receptions (incl. overtime)": "Receptions",
      "Total Rushing Plus Receiving Yards (incl. overtime)": "Rush+Rec yds",
      "Total Passing Plus Rushing Yards (incl. overtime)": "Pass+Rush yds",
    },
    nhl: {
    "Total Points": "Points",
    "Total Goals": "Goals",
    "Total Assists": "Assists",
    "Total Shots on Goal": "Shots on goal",
    "Total Hits": "Hits",
    "Total Blocked Shots": "Blocked shots",
    "Total Saves": "Saves",
  },
  mlb: {
    "Total Hits": "Hits",
    "Total Home Runs Hit": "Home runs",
    "Total Runs Scored": "Runs",
    "Total RBIs": "RBIs",
    "Total Hits + Runs + RBIs": "Hits+Runs+RBIs",
    "Total Strikeouts": "Pitcher strikeouts",
    "Earned Runs Allowed": "Earned runs allowed",
    "Total Walks Allowed": "Walks allowed",
    "Total Hits Allowed": "Hits allowed",
    "Total Outs Recorded": "Outs recorded",
  },
}[KEY] ?? {};

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

/** One main line per player and market: a balanced priced pair, else the line listed most. */
function mainLines(rows) {
  const pairs = new Map();
  const bare = new Map();
  for (const r of rows) {
    if (!LABELS[r.t] || !r.a) continue;
    const cur = r.cur ?? r.cl ?? r.op;
    if (!cur || cur[0] == null) continue;
    const [line, o, u] = cur;
    const opened = r.op?.[0] ?? null;
    const key = `${r.a}|${r.t}`;
    // unlabeled DraftKings sides (px = [current, open]): first item is the over, the next the under
    const side = o == null && u == null && r.px ? r.px[0] : null;
    if (side != null) {
      const pk = `${key}|${line}`;
      const p = pairs.get(pk) ?? { a: r.a, t: r.t, line, opened, o: null, u: null };
      if (p.o == null) p.o = side;
      else if (p.u == null) p.u = side;
      pairs.set(pk, p);
      continue;
    }
    if (o == null && u == null) {
      const m = bare.get(key) ?? new Map();
      const e = m.get(line) ?? { n: 0, opened };
      e.n += 1;
      m.set(line, e);
      bare.set(key, m);
      continue;
    }
    const pk = `${key}|${line}`;
    const p = pairs.get(pk) ?? { a: r.a, t: r.t, line, opened, o: null, u: null };
    if (o != null) p.o = o;
    if (u != null) p.u = u;
    pairs.set(pk, p);
  }
  const out = new Map();
  for (const p of pairs.values()) {
    if (p.o == null || p.u == null) continue;
    const bal = Math.abs(imp(p.o) - imp(p.u));
    if (bal > 0.25) continue;
    const key = `${p.a}|${p.t}`;
    if (!out.has(key) || bal < out.get(key).bal) out.set(key, { ...p, bal });
  }
  for (const [key, m] of bare) {
    if (out.has(key)) continue;
    const [line, e] = [...m.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
    const [a, t] = key.split("|");
    out.set(key, { a, t, line, opened: e.opened, o: null, u: null });
  }
  return [...out.values()];
}

/**
 * One game's board from a logger game file: each player's main line per market as of the newest props
 * snapshot (closing → latest → opening), where it opened, and prices (filled from saved DraftKings pulls).
 */
let filled = 0;
function boardOf(rec, price) {
  const snap = rec.props?.close ?? rec.props?.latest ?? rec.props?.open;
  if (!snap?.rows?.length) return null;
  const names = rec.names ?? {};
  const props = [];
  for (const l of mainLines(snap.rows)) {
    const who = names[l.a];
    if (!who) continue;
    let { line, o, u } = l;
    if (o == null && u == null && price.size) {
      // ESPN lists DraftKings' line without prices: the saved price at that line, else DraftKings'
      // newest priced line (ESPN's copy lags when the line has moved)
      const p = price(rec.home?.name, rec.date, who[0], LABELS[l.t], line);
      const mn = p ? null : price.main(rec.home?.name, rec.date, who[0], LABELS[l.t]);
      if (p) [o, u] = [p[0], p[1]];
      else if (mn) [line, o, u] = [mn[0], mn[1], mn[2]];
      if (p || mn) filled += 1;
    }
    const ladder = price.size ? price.ladder(rec.home?.name, rec.date, who[0], LABELS[l.t]) : null;
    props.push([who[0], who[1], LABELS[l.t], line, o, u, l.opened, ...(ladder ? [ladder] : [])]);
  }
  // DraftKings' touchdown-scorer prices from the newest saved pull (NFL): [[player, team abbr, anytime,
  // first, 2+, last]]
  const td = price.td
    ? price
        .td(rec.home?.name, rec.date)
        ?.map(([n, side, ...px]) => [n, side === "home" ? (rec.home?.abbr ?? "") : side === "away" ? (rec.away?.abbr ?? "") : "", ...px])
    : null;
  if (!props.length) return null;
  props.sort(
    (x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]),
  );
  return {
    id: rec.id,
    date: rec.date,
    name: rec.name,
    at: snap.at,
    away: { abbr: rec.away?.abbr ?? "", name: rec.away?.name ?? "" },
    home: { abbr: rec.home?.abbr ?? "", name: rec.home?.name ?? "" },
    props,
    ...(td?.length ? { td } : {}),
  };
}

async function main() {
  const root = join(DATA, KEY);
  const seasons = (await readdir(root).catch(() => [])).sort().slice(-2);
  const games = [];
  const price = await loadPrices(PRICES);
  let closed = 0;
  for (const season of seasons) {
    for (const f of await readdir(join(root, season)).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      // file names start with the game's US day; skip anything clearly past
      const day = Date.parse(`${f.slice(0, 10)}T12:00:00Z`);
      const upcoming = day >= NOW - 2 * 86_400_000 && day <= NOW + AHEAD;
      const closedFile = (id) => join(OUT, KEY, "closed", `${id}.json`);
      if (!upcoming && !(CLOSED.has(KEY) && day <= NOW + 86_400_000)) continue;
      const rec = JSON.parse(await readFile(join(root, season, f), "utf8"));
      const start = Date.parse(rec.date);
      if (CLOSED.has(KEY) && rec.id && (start <= NOW || rec.state === "post")) {
        // started or finished: its closing board, once (and refreshed while recent)
        if (start > NOW - RECENT || !(await stat(closedFile(rec.id)).catch(() => null))) {
          const board = boardOf(rec, price);
          if (board) {
            await mkdir(join(OUT, KEY, "closed"), { recursive: true });
            await writeFile(closedFile(rec.id), JSON.stringify(board));
            closed += 1;
          }
        }
        continue;
      }
      if (!upcoming) continue;
      if (!(start > NOW && start <= NOW + AHEAD) || rec.state === "post") continue;
      const board = boardOf(rec, price);
      if (board) games.push(board);
    }
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir(join(OUT, KEY), { recursive: true });
  await writeFile(join(OUT, KEY, "upcoming.json"), JSON.stringify(games));
  console.log(`${KEY}: ${games.length} upcoming games with prop lines${price.size ? `, ${filled} priced from saved DraftKings pulls` : ""}${CLOSED.has(KEY) ? `, ${closed} closing boards written` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
