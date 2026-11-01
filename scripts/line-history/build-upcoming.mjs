#!/usr/bin/env node
/**
 * The site's "Upcoming games" prop lines: from the hourly logger's game files (line-history branch),
 * every game that hasn't started, with each player's main line per market as of the newest snapshot
 * (closing → latest → opening), where it opened, and prices when posted.
 *   <out>/<league>/upcoming.json  [{ id, date, name, away, home, at, props: [[player, team, market, line, over, under, opened]] }]
 *
 *   node scripts/line-history/build-upcoming.mjs --data data --out props-site --league nba
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "data");
const OUT = opt("out", "props-site");
const NOW = Date.now();
const AHEAD = (KEY === "nfl" || KEY === "cfb" ? 8 : 3) * 86_400_000;

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

async function main() {
  const root = join(DATA, KEY);
  const seasons = (await readdir(root).catch(() => [])).sort().slice(-2);
  const games = [];
  for (const season of seasons) {
    for (const f of await readdir(join(root, season)).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      // file names start with the game's US day; skip anything clearly past
      const day = Date.parse(`${f.slice(0, 10)}T12:00:00Z`);
      if (!(day >= NOW - 2 * 86_400_000 && day <= NOW + AHEAD)) continue;
      const rec = JSON.parse(await readFile(join(root, season, f), "utf8"));
      const start = Date.parse(rec.date);
      if (!(start > NOW && start <= NOW + AHEAD) || rec.state === "post") continue;
      const snap = rec.props?.close ?? rec.props?.latest ?? rec.props?.open;
      if (!snap?.rows?.length) continue;
      const names = rec.names ?? {};
      const props = [];
      for (const l of mainLines(snap.rows)) {
        const who = names[l.a];
        if (!who) continue;
        props.push([who[0], who[1], LABELS[l.t], l.line, l.o, l.u, l.opened]);
      }
      if (!props.length) continue;
      props.sort(
        (x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]),
      );
      games.push({
        id: rec.id,
        date: rec.date,
        name: rec.name,
        at: snap.at,
        away: { abbr: rec.away?.abbr ?? "", name: rec.away?.name ?? "" },
        home: { abbr: rec.home?.abbr ?? "", name: rec.home?.name ?? "" },
        props,
      });
    }
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir(join(OUT, KEY), { recursive: true });
  await writeFile(join(OUT, KEY, "upcoming.json"), JSON.stringify(games));
  console.log(`${KEY}: ${games.length} upcoming games with prop lines`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
