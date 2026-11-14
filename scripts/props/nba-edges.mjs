#!/usr/bin/env node
/**
 * NBA prop edge finder: one book's line vs the other books' consensus (research/props/nba_consensus.py on the
 * mls-research branch; project doc props-research.md).
 *
 * For each player prop (points, rebounds, assists, threes) every book's main line and no-vig over chance
 * become an implied mean: mean = line + z(no-vig over) × sd, sd = k × √line. The consensus is the other books'
 * average implied mean (3+ books on the prop). A US book whose line or price is off the consensus by enough
 * expected value (EV, at that book's own price) is flagged, one flag per prop (best book), at first sighting:
 *   tier "10": EV 10%+   bet, 1 unit   (2023-24 closing lines, bet only at DraftKings / MGM / Caesars /
 *                                       ESPN BET: 562 bets, 59.3%, +14.2%)
 *   tier "6":  EV 6–10%  tracked only  (−0.6% at those books; +7.4% when SugarHouse / PointsBet counted)
 *   tier "4":  EV 4–6%   tracked only  (+1.0%)
 *
 * Each run: pulls today's NBA props from SportsGameOdds (every book, one request per game; skips when the
 * month's allowance is nearly used), grades earlier flags from ESPN box scores, and writes
 * <out>/nba/edges-<season>.json (flags with results, record per tier).
 *
 *   SPORTSGAMEODDS_API_KEY=... node scripts/props/nba-edges.mjs --out site [--hours 16] [--no-pull] [--keep 300]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = opt("out", "site");
const HOURS = Number(opt("hours", "16"));
const KEEP = Number(opt("keep", "300"));
const PULL = !args.includes("--no-pull");
const KEY = process.env.SPORTSGAMEODDS_API_KEY;
const SGO = "https://api.sportsgameodds.com/v2";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

/** SportsGameOdds stat id → market, with the spread factor k (sd = k × √line) fit on 2023-24. */
export const MARKETS = {
  points: ["PTS", 1.721],
  rebounds: ["REB", 1.171],
  assists: ["AST", 1.146],
  threePointersMade: ["3PT", 1.179],
};
/**
 * The books flags are bet at (the big US books): DraftKings, FanDuel, BetMGM, Caesars, theScore Bet (was
 * ESPN BET), Fanatics, Hard Rock and bet365. Every other listed book (offshore, regional) still counts
 * toward the consensus.
 */
export const BETTABLE = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  williamhill: "Caesars",
  espnbet: "theScore Bet",
  thescorebet: "theScore Bet",
  fanatics: "Fanatics",
  hardrockbet: "Hard Rock",
  bet365: "bet365",
};
export const TIERS = [
  ["10", 0.1],
  ["6", 0.06],
  ["4", 0.04],
];

const num = (v) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};
export const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
export const payout = (o) => (o < 0 ? 100 / -o : o / 100);

// standard normal CDF and its inverse (Acklam)
export function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
export function phiInv(p) {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    );
  }
  if (q > 1 - 0.02425) return -phiInv(1 - q);
  const r = q - 0.5;
  const s = r * r;
  return (
    ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) /
    (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
  );
}

/**
 * Every book's main line for each player prop in one SportsGameOdds event:
 * Map "playerID|market" → { name, team, market, books: Map(book → [line, over, under]) }.
 */
export function propBooks(e) {
  const out = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    const mk = MARKETS[m.statID];
    if (!mk || !m.playerID || m.periodID !== "game" || m.betTypeID !== "ou" || m.started) continue;
    if (m.sideID !== "over" && m.sideID !== "under") continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const key = `${m.playerID}|${mk[0]}`;
    const team =
      p?.teamID === e.teams?.home?.teamID
        ? "home"
        : p?.teamID === e.teams?.away?.teamID
          ? "away"
          : "";
    const rec = out.get(key) ?? { name, team, market: mk[0], k: mk[1], books: new Map() };
    for (const [book, b] of Object.entries(m.byBookmaker ?? {})) {
      if (!b || b.available === false) continue;
      const line = num(b.overUnder);
      const price = num(b.odds);
      if (line == null || price == null) continue;
      const row = rec.books.get(book) ?? [line, null, null];
      if (row[0] !== line) continue; // over and under must be the same line
      if (m.sideID === "over") row[1] = price;
      else row[2] = price;
      rec.books.set(book, row);
    }
    out.set(key, rec);
  }
  return out;
}

/** The best edge on one prop (or null): book, side, line, price, EV, consensus line, number of books. */
export function bestEdge(rec) {
  const books = [...rec.books].filter(
    ([, r]) => r[1] != null && r[2] != null && Math.abs(implied(r[1]) - implied(r[2])) <= 0.2,
  );
  if (books.length < 3) return null;
  const rows = books.map(([book, [line, o, u]]) => {
    const nv = implied(o) / (implied(o) + implied(u));
    const sd = rec.k * Math.sqrt(Math.max(line, 0.5));
    return { book, line, o, u, sd, mean: line + phiInv(Math.min(Math.max(nv, 0.02), 0.98)) * sd };
  });
  const sumMean = rows.reduce((s, r) => s + r.mean, 0);
  const sumLine = rows.reduce((s, r) => s + r.line, 0);
  let best = null;
  for (const r of rows) {
    if (!BETTABLE[r.book]) continue;
    const cons = (sumMean - r.mean) / (rows.length - 1);
    const pOver = 1 - phi((r.line - cons) / r.sd);
    const evO = pOver * payout(r.o) - (1 - pOver);
    const evU = (1 - pOver) * payout(r.u) - pOver;
    const side = evO >= evU ? "over" : "under";
    const ev = Math.max(evO, evU);
    if (!best || ev > best.ev)
      best = {
        book: r.book,
        side,
        line: r.line,
        price: side === "over" ? r.o : r.u,
        ev,
        chance: side === "over" ? pOver : 1 - pOver,
        consMean: cons,
        consLine: (sumLine - r.line) / (rows.length - 1),
        books: rows.length,
      };
  }
  return best;
}

export const tierOf = (ev) => TIERS.find(([, t]) => ev >= t)?.[0] ?? null;

async function get(url, headers = {}) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return r.json();
      if (r.status < 500)
        throw new Error(
          `${r.status} ${url.replace(/apiKey=[^&]+/, "")}: ${(await r.text()).slice(0, 160)}`,
        );
    } catch (e) {
      if (t === 2) throw e;
    }
    await new Promise((res) => setTimeout(res, 2000 * (t + 1)));
  }
  return null;
}
const sgo = (path) => get(`${SGO}${path}`, { "X-Api-Key": KEY });

const etDay = (iso) => new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");

/** NBA season label ("2026-27") for a date: October starts a new season. */
const seasonOf = (iso) => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 8 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
};

async function pull(file, now) {
  const usage = (await sgo("/account/usage/"))?.data?.rateLimits?.["per-month"] ?? {};
  const used = num(usage["current-entities"]);
  const max = num(usage["max-entities"]);
  const left = used != null && max != null ? max - used : null;
  file.usage = { used, max, at: new Date(now).toISOString() };
  console.log(`SportsGameOdds month usage: ${used}/${max}`);
  const room = left == null ? 15 : Math.min(30, left - KEEP);
  if (room <= 0) {
    console.log(
      `skipping the pull: ${left} events left this month (keeping ${KEEP} for the other pulls)`,
    );
    file.skipped = { at: new Date(now).toISOString(), left };
    return 0;
  }
  const q = new URLSearchParams({
    leagueID: "NBA",
    oddsAvailable: "true",
    startsAfter: new Date(now).toISOString(),
    startsBefore: new Date(now + HOURS * 3_600_000).toISOString(),
    limit: String(room),
  });
  const res = await sgo(`/events/?${q}`);
  const events = res?.data ?? [];
  const have = new Set(file.flags.map((f) => f.id));
  const seenStats = new Set();
  let added = 0;
  let props = 0;
  for (const e of events) {
    const start = e.status?.startsAt;
    if (!start || e.status?.started) continue;
    for (const m of Object.values(e.odds ?? {})) if (m.playerID) seenStats.add(m.statID);
    const home = e.teams?.home?.names?.long ?? e.teams?.home?.names?.medium ?? "";
    const away = e.teams?.away?.names?.long ?? e.teams?.away?.names?.medium ?? "";
    for (const rec of propBooks(e).values()) {
      const edge = bestEdge(rec);
      if (!edge) continue;
      props += 1;
      const tier = tierOf(edge.ev);
      if (!tier) continue;
      const id = `${e.eventID}|${norm(rec.name)}|${rec.market}`;
      if (have.has(id)) {
        const f = file.flags.find((x) => x.id === id);
        if (f) f.seen = (f.seen ?? 1) + 1;
        continue;
      }
      have.add(id);
      added += 1;
      file.flags.push({
        id,
        event: e.eventID,
        start,
        date: etDay(start),
        home,
        away,
        player: rec.name,
        team: rec.team === "home" ? home : rec.team === "away" ? away : "",
        market: rec.market,
        side: edge.side,
        line: edge.line,
        book: BETTABLE[edge.book],
        price: edge.price,
        ev: Math.round(edge.ev * 1000) / 1000,
        chance: Math.round(edge.chance * 1000) / 1000,
        consLine: Math.round(edge.consLine * 10) / 10,
        consMean: Math.round(edge.consMean * 10) / 10,
        books: edge.books,
        tier,
        at: new Date(now).toISOString(),
        seen: 1,
      });
    }
  }
  console.log(`${events.length} games, ${props} props with 3+ books, ${added} new flags`);
  if (!props) console.log(`player stat ids seen: ${[...seenStats].slice(0, 40).join(", ")}`);
  return added;
}

/** ESPN box score stats for one game, by normalized player name: { PTS, REB, AST, 3PT, MIN }. */
async function boxFor(date, home, away, cache) {
  const day = date.replace(/-/g, "");
  if (!cache.has(day))
    cache.set(
      day,
      get(`${ESPN}/scoreboard?dates=${day}`).catch(() => null),
    );
  const sb = await cache.get(day);
  const ev = (sb?.events ?? []).find((x) => {
    const names = (x.competitions?.[0]?.competitors ?? []).map((c) => norm(c.team?.displayName));
    return names.includes(norm(home)) && names.includes(norm(away));
  });
  if (!ev) return null;
  if (ev.status?.type?.completed !== true) return { pending: true };
  const key = `box:${ev.id}`;
  if (!cache.has(key))
    cache.set(
      key,
      get(`${ESPN}/summary?event=${ev.id}`).catch(() => null),
    );
  const s = await cache.get(key);
  const out = new Map();
  for (const team of s?.boxscore?.players ?? []) {
    const st = team.statistics?.[0];
    const labels = st?.labels ?? [];
    for (const a of st?.athletes ?? []) {
      const v = Object.fromEntries(labels.map((l, i) => [l, a.stats?.[i]]));
      const n = (x) => num(String(x ?? "").split("-")[0]);
      out.set(norm(a.athlete?.displayName), {
        PTS: n(v.PTS),
        REB: n(v.REB),
        AST: n(v.AST),
        "3PT": n(v["3PT"]),
        MIN: n(v.MIN),
        dnp: a.didNotPlay === true || !a.stats?.length,
      });
    }
  }
  return out;
}

async function grade(file, now) {
  const cache = new Map();
  let graded = 0;
  for (const f of file.flags) {
    if (f.res || Date.parse(f.start) > now - 3 * 3_600_000) continue;
    const box = await boxFor(f.date, f.home, f.away, cache);
    if (!box || box.pending) {
      if (now - Date.parse(f.start) > 3 * 86_400_000) f.res = "void"; // never found: don't hold it forever
      continue;
    }
    const p = box.get(norm(f.player));
    if (!p || p.dnp || !p.MIN) {
      f.res = "void"; // didn't play: books void the bet
      graded += 1;
      continue;
    }
    const v = p[f.market];
    if (v == null) continue;
    f.actual = v;
    f.res = v === f.line ? "push" : v > f.line === (f.side === "over") ? "win" : "loss";
    graded += 1;
  }
  return graded;
}

function record(flags) {
  const r = Object.fromEntries(TIERS.map(([t]) => [t, [0, 0, 0, 0]]));
  for (const f of flags) {
    const x = r[f.tier];
    if (!x || !f.res || f.res === "void") continue;
    if (f.res === "win") {
      x[0] += 1;
      x[3] += payout(f.price);
    } else if (f.res === "loss") {
      x[1] += 1;
      x[3] -= 1;
    } else x[2] += 1;
  }
  for (const x of Object.values(r)) x[3] = Math.round(x[3] * 100) / 100;
  return r;
}

async function main() {
  const now = Date.now();
  const season = seasonOf(new Date(now).toISOString());
  const path = join(OUT, "nba", `edges-${season}.json`);
  let file = { season, flags: [] };
  try {
    file = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // first run of the season
  }
  if (PULL && KEY) await pull(file, now).catch((e) => console.log(`pull failed: ${e.message}`));
  else if (PULL) console.log("SPORTSGAMEODDS_API_KEY is not set; grading only.");
  const g = await grade(file, now);
  file.flags.sort((a, b) => a.start.localeCompare(b.start) || b.ev - a.ev);
  file.record = record(file.flags);
  file.updated = new Date(now).toISOString();
  file.rule = {
    tiers: Object.fromEntries(TIERS),
    k: Object.fromEntries(Object.values(MARKETS)),
    minBooks: 3,
  };
  await mkdir(join(OUT, "nba"), { recursive: true });
  await writeFile(path, JSON.stringify(file));
  console.log(`graded ${g}; record ${JSON.stringify(file.record)}; wrote ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
