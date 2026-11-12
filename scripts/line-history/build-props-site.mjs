#!/usr/bin/env node
/**
 * Small per-day files for the site's "Prop history" pages, built from the props-history branch:
 *   <out>/<league>/index.json               { seasons: { "2024-25": ["2024-10-22", ...] } }
 *   <out>/<league>/<season>/<YYYY-MM-DD>.json  [ game, ... ]
 * Each game: { id, date, name, away, home, final, props: [[player, team, market, line, over, under, actual, dnp?]],
 *   sp?: [[player, team, bet, price, opening price, won]] }
 * dnp = 1: the player didn't play (NFL game roster, NBA box-score DNP; the bet is void), actual null.
 * sp: yes-only bets (anytime goalscorer, double-double, first basket…) at the last price ESPN kept;
 * won = 1 / 0, "void" (didn't play), null (can't tell from what ESPN saved).
 * One row per player and market: the main line (the sportsbook's balanced over/under pair; for books
 * that send lines without prices, the line itself). Opening lines are used: ESPN's "current" line
 * kept moving during games for some books, so it isn't a reliable pregame close.
 *
 * NBA also gets <out>/nba/reb-stars-<season>.json: the graded ★ rebound-under picks (nba-reb-stars.mjs) and
 * every player's projection inputs, so the site can star today's lines.
 *
 *   node scripts/line-history/build-props-site.mjs --data props-history --out props-site --league nba [--season 2026-27]
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadPrices } from "./odds-api-prices.mjs";
import {
  replayRebStars,
  REB_STAR_EDGE,
  REB_STAR_MIN_GAMES,
  REB_STAR_WORST_PRICE,
} from "./nba-reb-stars.mjs";
import { EXTRA_OU, milestonesOf, specialsOf } from "./prop-markets.mjs";

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
  // ESPN's box "SOG" column is always 0; "S" is shots on goal (missed shots are "SM")
  "Total Shots on Goal": ["Shots on goal", (s) => nhl(s, "S") ?? nhl(s, "SOG")],
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
  "Total Hits + Runs + RBIs": [
    "Hits+Runs+RBIs",
    (s) => sum(bat("H")(s), bat("R")(s), bat("RBI")(s)),
  ],
  "Total Strikeouts": ["Pitcher strikeouts", pit("K")],
  "Earned Runs Allowed": ["Earned runs allowed", pit("ER")],
  "Total Walks Allowed": ["Walks allowed", pit("BB")],
  "Total Hits Allowed": ["Hits allowed", pit("H")],
  "Total Outs Recorded": ["Outs recorded", (s) => (isPitcher(s) ? outs(s.IP) : null)],
};
/**
 * Graders for the extra over/unders in prop-markets.mjs, by site label. (s, { a, g }): the player's box
 * line, their athlete id and the game (g.ev holds the play-by-play facts).
 */
const def = (k) => (s) => num(s[`defensive.${k}`]) ?? 0;
/** A batter's hit types from the plays, only when they add up to the box score's hits. */
const hitTypes = (s, { a, g }) => {
  if (!g.ev?.bat || (isPitcher(s) && s.AB == null)) return null;
  const b = g.ev.bat[a] ?? { "1B": 0, "2B": 0, "3B": 0, SB: 0 };
  const hr = num(s.HR) ?? 0;
  return b["1B"] + b["2B"] + b["3B"] + hr === num(s.H) ? { ...b, HR: hr } : null;
};
const EXTRA_GRADE = {
  Tackles: def("SOLO"),
  "Tackles+Ast": def("TOT"),
  "Tackle ast": (s) => (num(s["defensive.TOT"]) ?? 0) - (num(s["defensive.SOLO"]) ?? 0),
  Sacks: def("SACKS"),
  "Kicking pts": (s) => num(s["kicking.PTS"]) ?? 0,
  "FGs made": (s) => num(s["kicking.FG"]) ?? 0,
  "XPs made": (s) => num(s["kicking.XP"]) ?? 0,
  "Longest rec": (s) => num(s["receiving.LONG"]) ?? 0,
  "Longest rush": (s) => num(s["rushing.LONG"]) ?? 0,
  "Total bases": (s, c) => {
    const h = hitTypes(s, c);
    return h ? h["1B"] + 2 * h["2B"] + 3 * h["3B"] + 4 * h.HR : null;
  },
  Singles: (s, c) => hitTypes(s, c)?.["1B"] ?? null,
  Doubles: (s, c) => hitTypes(s, c)?.["2B"] ?? null,
  "Stolen bases": (s, { a, g }) =>
    g.ev?.bat && !(isPitcher(s) && s.AB == null) ? (g.ev.bat[a]?.SB ?? 0) : null,
  Walks: bat("BB"),
  "Stl+Blk": (s) => sum(num(s.STL), num(s.BLK)),
  "Field goals": (s) => num(s.FG),
};
const BASE = { nba: NBA, wnba: NBA, nfl: FB, cfb: FB, nhl: NHL, mlb: MLB }[KEY] ?? {};
const MARKETS = { ...BASE };
const EXTRA_MARKETS = new Set(Object.keys(EXTRA_OU[KEY] ?? {}));
for (const [t, label] of Object.entries(EXTRA_OU[KEY] ?? {}))
  if (EXTRA_GRADE[label]) MARKETS[t] = [label, EXTRA_GRADE[label]];

/** Did a yes-only bet win? 1 / 0, "void" (didn't play), null (not enough saved to tell). */
export function gradeSpecial(label, a, g) {
  const bx = g.box?.[a];
  if (!bx) return null;
  if (bx.dnp) return "void";
  const s = bx.s ?? {};
  const ev = g.ev;
  const first = (id) => (ev ? (id === a ? 1 : 0) : null);
  const at = (n, k) => (n == null ? null : n >= k ? 1 : 0);
  switch (label) {
    case "Anytime goal":
      return at(nhl(s, "G"), 1);
    case "2+ goals":
      return at(nhl(s, "G"), 2);
    case "Hat trick":
      return at(nhl(s, "G"), 3);
    case "First goal":
      return first(ev?.fg);
    case "Last goal":
      return first(ev?.lg);
    case "First team goal":
      return first(ev?.ftg?.[bx.tm]);
    case "Double-double":
    case "Triple-double": {
      const v = [s.PTS, s.REB, s.AST, s.STL, s.BLK].map(num);
      if (v.some((x) => x == null)) return null;
      return at(v.filter((x) => x >= 10).length, label === "Double-double" ? 2 : 3);
    }
    case "First basket":
      return first(ev?.fb);
    case "First team basket":
      return first(ev?.ftb?.[bx.tm]);
    case "First 3-pointer":
      return ev && "f3" in ev ? first(ev.f3) : null;
    case "First home run":
      return first(ev?.fhr);
    case "Win (pitcher)":
      return ev?.w ? (ev.w === a ? 1 : 0) : null;
    default:
      return null;
  }
}

/** A game's yes-only bets: [[player, team, bet, price, opening price, won?]] for players on the box score. */
function specialsBoard(g, graded) {
  const rows = [];
  for (const [pid, b] of Object.entries(g.books ?? {}))
    for (const [a, label, price, open] of specialsOf(b.rows, KEY, pid)) {
      const bx = g.box?.[a];
      if (!bx || rows.some((r) => r.a === a && r.label === label)) continue;
      rows.push({
        a,
        label,
        row: [bx.n, bx.tm, label, price, open, ...(graded ? [gradeSpecial(label, a, g)] : [])],
      });
    }
  return rows
    .map((r) => r.row)
    .sort((x, y) => x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]) || x[3] - y[3]);
}

/** Each player's milestone ladder ("15+ points" = over 14.5) from the most preferred book that has one. */
function laddersOf(g) {
  const out = new Map();
  for (const b of Object.values(g.books ?? {}))
    for (const [k, ladder] of milestonesOf(b.rows, KEY)) if (!out.has(k)) out.set(k, ladder);
  return out;
}
/**
 * Leagues whose game pages read each finished game's closing board from here (the line logger saves
 * none for them): <out>/<league>/closed/<event id>.json, the same shape as build-upcoming.mjs writes.
 */
const CLOSED_FROM_HISTORY = new Set(["mlb", "wnba"]);

/**
 * A finished game's closing board from ESPN's props history: each player's main line as ESPN last kept
 * it (the close) with its prices, and where that market opened. Rows: [player, team, market, close,
 * over, under, opened]. Players not on the box score are left out.
 */
export function closingBoard(g, openMain = mainLines(g.books ?? {})) {
  const books = {};
  for (const [pid, b] of Object.entries(g.books ?? {}))
    books[pid] = {
      ...b,
      rows: b.rows.map((r) => {
        const cur = r.cur ?? r.cl ?? r.op;
        const px = r.px ? (r.px[0] ?? r.px[1]) : null;
        return { ...r, op: cur, ...(r.px ? { px: [px, px] } : {}) };
      }),
    };
  const opened = new Map(openMain.map((p) => [`${p.a}|${p.t}`, p.line]));
  const ladders = laddersOf(g);
  const props = [];
  for (const p of mainLines(books)) {
    const bx = g.box?.[p.a];
    if (!bx || bx.dnp) continue;
    const [label] = MARKETS[p.t];
    // milestone rungs other than the main line itself ("1+ hits" is the same bet as over 0.5)
    const ladder = ladders.get(`${p.a}|${label}`)?.filter(([ln]) => ln !== p.line);
    props.push([
      bx.n,
      bx.tm,
      label,
      p.line,
      p.o,
      p.u,
      opened.get(`${p.a}|${p.t}`) ?? null,
      ...(ladder?.length ? [ladder] : []),
    ]);
  }
  const sp = specialsBoard(g, false);
  props.sort(
    (x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]),
  );
  return {
    id: g.id,
    date: g.date,
    name: g.name,
    away: { abbr: g.away?.abbr, name: g.away?.name },
    home: { abbr: g.home?.abbr, name: g.home?.name },
    props,
    ...(sp.length ? { sp } : {}),
  };
}

const imp = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

export function mainLines(books) {
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
    // how many priced lines each player's market has: a lone line is the main line however lopsided
    // its prices (MLB "Over 0.5 RBIs" at +150 / −200); the balance test only picks among alternates
    const lineCount = new Map();
    for (const p of pairs.values())
      if (p.o != null && p.u != null)
        lineCount.set(`${p.a}|${p.t}`, (lineCount.get(`${p.a}|${p.t}`) ?? 0) + 1);
    for (const p of pairs.values()) {
      if (p.o == null || p.u == null) continue;
      const bal = Math.abs(imp(p.o) - imp(p.u));
      const key = `${p.a}|${p.t}`;
      if (bal > 0.25 && lineCount.get(key) > 1) continue;
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
      const [a, t] = key.split("|");
      // a newly added market listed at several lines with no prices is a ladder of alternates (ESPN
      // BET's 2024-25 steals + blocks: 0.5 through 4.5), not a main line: leave it out
      if (EXTRA_MARKETS.has(t) && m.size > 1) continue;
      const [line, e] = [...m.entries()].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
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
    const replay = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const g = JSON.parse(line);
      const props = [];
      const main = mainLines(g.books ?? {});
      if (KEY === "nba" && Number(g.seasonType ?? 2) === 2) {
        replay.push({
          id: g.id,
          date: g.date,
          name: g.name,
          box: g.box,
          reb: main
            .filter((p) => p.t === "Total Rebounds")
            .map((p) => ({ a: p.a, line: p.line, u: p.u })),
        });
      }
      for (const p of main) {
        let bx = g.box?.[p.a];
        // NFL: no box-score line. Played (on the game roster) = 0 of everything; didn't play = void.
        const ro = !bx ? g.roster?.[p.a] : undefined;
        if (ro?.played) bx = { n: ro.n, tm: ro.tm, s: {} };
        if (ro && !ro.played) {
          const [label] = MARKETS[p.t];
          props.push([ro.n, ro.tm, label, p.line, p.o, p.u, null, 1]);
          continue;
        }
        if (!bx) continue;
        if (bx.dnp) {
          // on the box score as DNP (NBA): the bet is void
          props.push([bx.n, bx.tm, MARKETS[p.t][0], p.line, p.o, p.u, null, 1]);
          continue;
        }
        const [label, stat] = MARKETS[p.t];
        let { line, o, u } = p;
        if (o == null && u == null && price.size) {
          // ESPN's NFL lines have no prices: use DraftKings' priced line from the last pull before
          // kickoff (same line as ESPN's opener when it hasn't moved)
          const px = price(g.home?.name, g.date, bx.n, label, line) ?? null;
          const mn = px ? null : price.main(g.home?.name, g.date, bx.n, label);
          if (px) [o, u] = px;
          else if (mn) [line, o, u] = mn;
        }
        props.push([
          bx.n,
          bx.tm,
          label,
          line,
          o,
          u,
          ro?.played ? 0 : stat(bx.s ?? {}, { a: p.a, g }),
        ]);
      }
      const sp = specialsBoard(g, true);
      if (!props.length && !sp.length) continue;
      if (CLOSED_FROM_HISTORY.has(KEY)) {
        const board = closingBoard(g, main);
        if (board.props.length || board.sp) {
          await mkdir(join(OUT, KEY, "closed"), { recursive: true });
          await writeFile(join(OUT, KEY, "closed", `${g.id}.json`), JSON.stringify(board));
        }
      }
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
        ...(sp.length ? { sp } : {}),
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
    if (KEY === "nba" && replay.length) {
      replay.sort((a, b) => a.date.localeCompare(b.date));
      const { picks, inputs } = replayRebStars(replay);
      const w = picks.filter((p) => p[9] === "win").length;
      const l = picks.filter((p) => p[9] === "loss").length;
      const units = picks.reduce((u, p) => {
        if (p[9] === "push") return u;
        const o = Number(p[6]);
        const win = Number.isFinite(o) && o !== 0 ? (o < 0 ? 100 / -o : o / 100) : 100 / 110;
        return u + (p[9] === "win" ? win : -1);
      }, 0);
      await writeFile(
        join(OUT, KEY, `reb-stars-${season}.json`),
        JSON.stringify({
          season,
          updated: new Date().toISOString(),
          rule: {
            edge: REB_STAR_EDGE,
            minGames: REB_STAR_MIN_GAMES,
            worstPrice: REB_STAR_WORST_PRICE,
          },
          record: [w, l, picks.length - w - l, Math.round(units * 100) / 100],
          // [date, gameId, game, player, team, opening line, under price, projection, rebounds, result]
          picks,
          // athleteId → [season reb/min, last-10 reb/min | null, weighted minutes, games]
          inputs,
        }),
      );
      console.log(
        `nba ${season} ★ rebound unders: ${w}-${l} (${units.toFixed(1)}u), ${Object.keys(inputs).length} players`,
      );
    }
    console.log(`${KEY} ${season}: ${byDay.size} days, ${[...byDay.values()].flat().length} games`);
  }
  await mkdir(join(OUT, KEY), { recursive: true });
  await writeFile(indexPath, JSON.stringify(index));
}

if (process.argv[1]?.endsWith("build-props-site.mjs"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
