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
import { loadPrices } from "./odds-api-prices.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const KEY = opt("league", "nba");
const DATA = opt("data", "props-history");
const OUT = opt("out", "props-site");
const ONLY = opt("season");
const PRICES = opt("prices"); // saved Odds API pulls (NFL), to fill prices ESPN doesn't show

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
const nhl = (s, k) => num(s[`forwards.${k}`] ?? s[`defenses.${k}`] ?? s[`goalies.${k}`] ?? s[k]);
const NHL = {
  "Total Points": ["Points", (s) => sum(nhl(s, "G"), nhl(s, "A"))],
  "Total Goals": ["Goals", (s) => nhl(s, "G")],
  "Total Assists": ["Assists", (s) => nhl(s, "A")],
  "Total Shots on Goal": ["Shots on goal", (s) => nhl(s, "SOG")],
  "Total Hits": ["Hits", (s) => nhl(s, "HT")],
  "Total Blocked Shots": ["Blocked shots", (s) => nhl(s, "BS")],
  "Total Saves": ["Saves", (s) => nhl(s, "SV")],
};
// MLB box scores mix batting and pitching labels; pitchers are the rows with innings pitched.
const isPitcher = (s) => s.IP != null;
const outs = (ip) => {
  const [w, f] = String(ip ?? "").split(".");
  const n = Number(w);
  return Number.isFinite(n) ? n * 3 + (Number(f) || 0) : null;
};
const bat = (k) => (s) => (isPitcher(s) && s.AB == null ? null : num(s[k]));
const pit = (k) => (s) => (isPitcher(s) ? num(s[k]) : null);
const MLB = {
  "Total Hits": ["Hits", bat("H")],
  "Total Home Runs Hit": ["Home runs", bat("HR")],
  "Total Runs Scored": ["Runs", bat("R")],
  "Total RBIs": ["RBIs", bat("RBI")],
  "Total Hits + Runs + RBIs": ["Hits+Runs+RBIs", (s) => sum(bat("H")(s), bat("R")(s), bat("RBI")(s))],
  "Total Strikeouts": ["Pitcher strikeouts", pit("K")],
  "Earned Runs Allowed": ["Earned runs allowed", pit("ER")],
  "Total Walks Allowed": ["Walks allowed", pit("BB")],
  "Total Hits Allowed": ["Hits allowed", pit("H")],
  "Total Outs Recorded": ["Outs recorded", (s) => (isPitcher(s) ? outs(s.IP) : null)],
};
const MARKETS = { nba: NBA, nfl: FB, cfb: FB, nhl: NHL, mlb: MLB }[KEY] ?? {};

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

function mainLines(books) {
  // book preference: DraftKings (40 old, 100 new), then ESPN BET, then anything
  const order = Object.keys(books).sort((a, b) => {
    const rank = (k) => (["100", "40"].includes(k) ? 0 : k === "58" ? 1 : 2);
    return rank(a) - rank(b);
  });
  const picked = new Map();
  // 1) a balanced over/under pair from the most preferred book that has one
  for (const pid of order) {
    const pairs = new Map();
    for (const r of books[pid].rows) {
      if (!MARKETS[r.t] || !r.a || !r.op || r.op[0] == null) continue;
      const [line, o, u] = r.op;
      const pk = `${r.a}|${r.t}|${line}`;
      // unlabeled DraftKings sides: first item is the over, the next the under
      const side = o == null && u == null && r.px ? (r.px[1] ?? r.px[0]) : null;
      if (o == null && u == null && side == null) continue;
      const p = pairs.get(pk) ?? { a: r.a, t: r.t, line, o: null, u: null };
      if (o != null) p.o = o;
      if (u != null) p.u = u;
      if (side != null) {
        if (p.o == null) p.o = side;
        else if (p.u == null) p.u = side;
      }
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
    for (const [key, p] of best) if (!picked.has(key)) picked.set(key, p);
  }
  // 2) otherwise the line the preferred book lists most (books without prices, or one-sided
  //    markets like "1+ goal"), keeping a price when there is one
  for (const pid of order) {
    const seen = new Map();
    for (const r of books[pid].rows) {
      if (!MARKETS[r.t] || !r.a || !r.op || r.op[0] == null) continue;
      const key = `${r.a}|${r.t}`;
      if (picked.has(key)) continue;
      const [line, o, u] = r.op;
      const m = seen.get(key) ?? new Map();
      const e = m.get(line) ?? { n: 0, o: null, u: null };
      e.n += 1;
      if (o != null) e.o = o;
      if (u != null) e.u = u;
      m.set(line, e);
      seen.set(key, m);
    }
    for (const [key, m] of seen) {
      const [line, e] = [...m.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
      const [a, t] = key.split("|");
      picked.set(key, { a, t, line, o: e.o, u: e.u });
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
  const price = await loadPrices(PRICES);
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
        let { o, u } = p;
        if (o == null && u == null && price.size) {
          const px = price(g.home?.name, g.date, bx.n, label, p.line);
          if (px) [o, u] = px;
        }
        props.push([bx.n, bx.tm, label, p.line, o, u, stat(bx.s ?? {})]);
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
