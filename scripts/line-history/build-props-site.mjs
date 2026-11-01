#!/usr/bin/env node
/**
 * Small per-day files for the site's "Prop history" pages, built from the props-history branch:
 *   <out>/<league>/index.json               { seasons: { "2024-25": ["2024-10-22", ...] } }
 *   <out>/<league>/<season>/<YYYY-MM-DD>.json  [ game, ... ]
 * Each game: { id, date, name, away, home, final, props: [[player, team, market, line, over, under, actual]] }
 * One row per player and market: the main line (the sportsbook's balanced over/under pair; for books
 * that send lines without prices, the line itself). Opening lines are used: ESPN's "current" line
 * kept moving during games for some books, so it isn't a reliable pregame close.
 *
 *   node scripts/line-history/build-props-site.mjs --data props-history --out props-site --league nba [--season 2026-27]
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "props-history");
const OUT = opt("out", "props-site");
const ONLY = opt("season");

const num = (v) => {
  const n = Number(String(v ?? "").split(/[-/]/)[0]);
  return Number.isFinite(n) ? n : null;
};
const sum = (...v) => (v.every((x) => x !== null) ? v.reduce((a, b) => a + b, 0) : null);

/** Market name → [short label, stat from the box score]. */
const NBA = {
  "Total Points": ["Points", (s) => num(s.PTS)],
  "Total Rebounds": ["Rebounds", (s) => num(s.REB)],
  "Total Assists": ["Assists", (s) => num(s.AST)],
  "Total 3-Point Field Goals": ["3-pointers", (s) => num(s["3PT"])],
  "Total Points, Rebounds, and Assists": [
    "Pts+Reb+Ast",
    (s) => sum(num(s.PTS), num(s.REB), num(s.AST)),
  ],
  "Total Points and Rebounds": ["Pts+Reb", (s) => sum(num(s.PTS), num(s.REB))],
  "Total Points and Assists": ["Pts+Ast", (s) => sum(num(s.PTS), num(s.AST))],
  "Total Assists and Rebounds": ["Reb+Ast", (s) => sum(num(s.AST), num(s.REB))],
  "Total Steals": ["Steals", (s) => num(s.STL)],
  "Total Blocks": ["Blocks", (s) => num(s.BLK)],
  "Total Turnovers": ["Turnovers", (s) => num(s.TO)],
};
const att = (s) => num(String(s["passing.C/ATT"] ?? "").split("/")[1]);
const cmp = (s) => num(String(s["passing.C/ATT"] ?? "").split("/")[0]);
const FB = {
  "Total Passing Yards (incl. overtime)": ["Pass yds", (s) => num(s["passing.YDS"])],
  "Total Passing Attempts (incl. overtime)": ["Pass att", att],
  "Total Pass Completions (incl. overtime)": ["Completions", cmp],
  "Total Passing Touchdowns (incl. overtime)": ["Pass TDs", (s) => num(s["passing.TD"])],
  "Total Passing Interceptions (incl. overtime)": ["Interceptions", (s) => num(s["passing.INT"])],
  "Total Rushing Yards (incl. overtime)": [
    "Rush yds",
    (s) => num(s["rushing.YDS"]) ?? (s["passing.YDS"] != null ? 0 : null),
  ],
  "Total Carries (incl. overtime)": ["Carries", (s) => num(s["rushing.CAR"])],
  "Total Receiving Yards (incl. overtime)": ["Rec yds", (s) => num(s["receiving.YDS"]) ?? 0],
  "Total Receptions (incl. overtime)": ["Receptions", (s) => num(s["receiving.REC"]) ?? 0],
  "Total Rushing Plus Receiving Yards (incl. overtime)": [
    "Rush+Rec yds",
    (s) => (num(s["rushing.YDS"]) ?? 0) + (num(s["receiving.YDS"]) ?? 0),
  ],
  "Total Passing Plus Rushing Yards (incl. overtime)": [
    "Pass+Rush yds",
    (s) => (num(s["passing.YDS"]) ?? 0) + (num(s["rushing.YDS"]) ?? 0),
  ],
};
const NHL = {
  "Total Points": ["Points", (s) => num(s["forwards.PTS"] ?? s["defenses.PTS"] ?? s.PTS)],
  "Total Goals": ["Goals", (s) => num(s["forwards.G"] ?? s["defenses.G"] ?? s.G)],
  "Total Assists": ["Assists", (s) => num(s["forwards.A"] ?? s["defenses.A"] ?? s.A)],
  "Total Shots on Goal": ["Shots", (s) => num(s["forwards.S"] ?? s["defenses.S"] ?? s.S)],
  "Total Saves": ["Saves", (s) => num(s["goalies.SV"] ?? s.SV)],
};
const MARKETS = { nba: NBA, nfl: FB, cfb: FB, nhl: NHL }[KEY] ?? {};

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

function mainLines(books) {
  // book preference: DraftKings (40 old, 100 new), then ESPN BET, then anything
  const order = Object.keys(books).sort((a, b) => {
    const rank = (k) => (["100", "40"].includes(k) ? 0 : k === "58" ? 1 : 2);
    return rank(a) - rank(b);
  });
  const picked = new Map();
  for (const pid of order) {
    const pairs = new Map();
    const bare = new Map();
    for (const r of books[pid].rows) {
      if (!MARKETS[r.t] || !r.a || !r.op || r.op[0] == null) continue;
      const key = `${r.a}|${r.t}`;
      if (picked.has(key)) continue;
      const [line, o, u] = r.op;
      if (o == null && u == null) {
        const m = bare.get(key) ?? new Map();
        m.set(line, (m.get(line) ?? 0) + 1);
        bare.set(key, m);
        continue;
      }
      const pk = `${key}|${line}`;
      const p = pairs.get(pk) ?? { a: r.a, t: r.t, line, o: null, u: null };
      if (o != null) p.o = o;
      if (u != null) p.u = u;
      pairs.set(pk, p);
    }
    const best = new Map();
    for (const p of pairs.values()) {
      if (p.o == null || p.u == null) continue;
      const bal = Math.abs(imp(p.o) - imp(p.u));
      if (bal > 0.25) continue;
      const key = `${p.a}|${p.t}`;
      if (!best.has(key) || bal < best.get(key).bal) best.set(key, { ...p, bal });
    }
    for (const [key, p] of best) picked.set(key, p);
    // books without prices (DraftKings via ESPN in 2026): the line ESPN lists as the main one
    for (const [key, m] of bare) {
      if (picked.has(key)) continue;
      const line = [...m.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
      const [a, t] = key.split("|");
      picked.set(key, { a, t, line, o: null, u: null });
    }
  }
  return [...picked.values()];
}

async function main() {
  const dir = join(DATA, KEY);
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl.gz"));
  const indexPath = join(OUT, KEY, "index.json");
  let index = { seasons: {} };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    // new index
  }
  for (const f of files) {
    const season = f.replace(".jsonl.gz", "");
    if (ONLY && season !== ONLY) continue;
    const text = gunzipSync(await readFile(join(dir, f))).toString("utf8");
    const byDay = new Map();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const g = JSON.parse(line);
      const props = [];
      for (const p of mainLines(g.books ?? {})) {
        const bx = g.box?.[p.a];
        if (!bx || bx.dnp) continue;
        const [label, stat] = MARKETS[p.t];
        props.push([bx.n, bx.tm, label, p.line, p.o, p.u, stat(bx.s ?? {})]);
      }
      if (!props.length) continue;
      props.sort(
        (x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]),
      );
      const day = new Date(new Date(g.date).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push({
        id: g.id,
        date: g.date,
        name: g.name,
        away: { abbr: g.away.abbr, name: g.away.name, score: g.final?.away ?? null },
        home: { abbr: g.home.abbr, name: g.home.name, score: g.final?.home ?? null },
        props,
      });
      byDay.set(day, list);
    }
    if (!byDay.size) continue;
    await mkdir(join(OUT, KEY, season), { recursive: true });
    for (const [day, games] of byDay) {
      games.sort((a, b) => a.date.localeCompare(b.date));
      await writeFile(join(OUT, KEY, season, `${day}.json`), JSON.stringify(games));
    }
    index.seasons[season] = [...byDay.keys()].sort();
    console.log(`${KEY} ${season}: ${byDay.size} days, ${[...byDay.values()].flat().length} games`);
  }
  await mkdir(join(OUT, KEY), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
