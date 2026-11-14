#!/usr/bin/env node
/**
 * NFL quarter / half edge finder: prices each book's 1st-quarter, 1st-half and team-total lines off the
 * full-game line, using how 2012-2025 games with a similar spread and total actually split by quarter
 * (scripts/props/nfl-partials-history.json; project doc football-partials.md).
 *
 * Tested on 2025 ESPN BET (priced) and 2026 DraftKings (unpriced) openers, with the full-game opener as the input:
 *   1st-quarter total and team 1st-half totals: the model's side hit 58-61% vs 43-49% for the other side at both
 *   books → WATCH (bet small, tracked live with real prices).
 *   1st-half total, team full-game totals, 1st-half / 1st-quarter spreads and moneylines, 2nd-half total: no
 *   steady edge or no prices to test → TRACK only.
 * Flags a market when a book's price is 5%+ EV against the model, one flag per market (best book), at first
 * sighting; grades from ESPN line scores. Writes <out>/nfl/partials-<season>.json.
 *
 *   node scripts/props/nfl-partials.mjs --markets site/markets/nfl.json --out site [--no-flag]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
export const MIN_EV = 0.05;
/** Flags are bet only at the big US books (offshore / regional lines still set the median). */
export const MAJOR = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "williamhill",
  "espnbet",
  "thescorebet",
  "fanatics",
  "hardrockbet",
  "bet365",
]);

/** market key → [label, watch?] */
export const MARKETS = {
  "1q|ou|all": ["1st quarter total", true],
  "1h|ou|home": ["Home 1st-half total", true],
  "1h|ou|away": ["Away 1st-half total", true],
  "1h|ou|all": ["1st half total", false],
  "2h|ou|all": ["2nd half total", false],
  "game|ou|home": ["Home team total", false],
  "game|ou|away": ["Away team total", false],
  "1h|sp|": ["1st half spread", false],
  "1q|sp|": ["1st quarter spread", false],
  "1h|ml|": ["1st half moneyline", false],
  "1q|ml|": ["1st quarter moneyline", false],
};

export const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
export const payout = (o) => (o < 0 ? 100 / -o : o / 100);

let HIST = null;
async function history() {
  if (!HIST)
    HIST = JSON.parse(await readFile(join(HERE, "nfl-partials-history.json"), "utf8")).rows;
  return HIST;
}

/**
 * Outcomes of similar past games, for a full-game line (home spread, − = home favored, and total):
 * per game { Q1, H1, H2, hH1, aH1, hG, aG, mH1, mQ1 } (home minus away for margins).
 */
export function similar(rows, homeSpread, total) {
  const s = -homeSpread; // history: + = home favored
  const pick = (w) => rows.filter((r) => Math.abs(r[0] - s) <= w && Math.abs(r[1] - total) <= w);
  let m = pick(1.5);
  if (m.length < 60) m = pick(3);
  return m.map((r) => ({
    Q1: r[2] + r[3],
    H1: r[2] + r[3] + r[4] + r[5],
    H2: r[10] + r[11] - (r[2] + r[3] + r[4] + r[5]),
    hH1: r[2] + r[4],
    aH1: r[3] + r[5],
    hG: r[10],
    aG: r[11],
    mH1: r[2] + r[4] - r[3] - r[5],
    mQ1: r[2] - r[3],
  }));
}

/** [P(side a wins), P(side b wins)] for a market (ties drop out: pushes / refunds). */
export function chances(sim, key, line) {
  const get = {
    "1q|ou|all": (g) => g.Q1,
    "1h|ou|all": (g) => g.H1,
    "2h|ou|all": (g) => g.H2,
    "1h|ou|home": (g) => g.hH1,
    "1h|ou|away": (g) => g.aH1,
    "game|ou|home": (g) => g.hG,
    "game|ou|away": (g) => g.aG,
  }[key];
  let a = 0;
  let b = 0;
  for (const g of sim) {
    let x;
    if (get)
      x = get(g) - line; // over vs under
    else if (key === "1h|sp|")
      x = g.mH1 + line; // home covers its spread vs away
    else if (key === "1q|sp|") x = g.mQ1 + line;
    else if (key === "1h|ml|") x = g.mH1;
    else if (key === "1q|ml|") x = g.mQ1;
    else return null;
    if (x > 0) a++;
    else if (x < 0) b++;
  }
  return a + b ? [a / sim.length, b / sim.length] : null;
}

/** The best-EV book and side for each tracked market of one game. */
export function edgesFor(game, rows) {
  const [sp, tot] = game.full ?? [];
  if (sp == null || tot == null) return [];
  const sim = similar(rows, sp, tot);
  const out = [];
  for (const [period, bet, who, stat, books] of game.mk ?? []) {
    if (stat !== "points") continue;
    const key = `${period}|${bet}|${who}`;
    if (!MARKETS[key]) continue;
    let best = null;
    const lines = Object.values(books)
      .map((c) => c[0])
      .filter((x) => x != null)
      .sort((x, y) => x - y);
    const mid = lines.length ? lines[Math.floor((lines.length - 1) / 2)] : null;
    for (const [book, [line, pa, pb]] of Object.entries(books)) {
      if (pa == null || pb == null || !MAJOR.has(book)) continue;
      if (mid != null && line != null && Math.abs(line - mid) > 1.5) continue; // off the other books: stale
      if (Math.abs(implied(pa) - implied(pb)) > 0.35) continue; // a stale or one-sided price
      const ch = chances(sim, key, line ?? 0);
      if (!ch) continue;
      const [a, b] = ch;
      const evA = a * payout(pa) - b;
      const evB = b * payout(pb) - a;
      const side = evA >= evB ? 0 : 1;
      const ev = Math.max(evA, evB);
      if (!best || ev > best.ev)
        best = {
          key,
          book,
          line,
          side,
          price: side ? pb : pa,
          ev,
          chance: side ? b / (a + b) : a / (a + b),
        };
    }
    if (best) out.push(best);
  }
  return out;
}

const sideName = (key, side) => {
  const bet = key.split("|")[1];
  if (bet === "ou") return side ? "under" : "over";
  return side ? "away" : "home";
};

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const nflSeason = (iso) => {
  const d = new Date(iso);
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
};

async function get(url) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return r.json();
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1500 * (t + 1)));
  }
  return null;
}

/** ESPN line scores for a finished game: { home: [q1..q4, ot...], away: [...] } or null / { pending }. */
async function lineScores(f, cache) {
  const day = new Date(Date.parse(f.start) - 5 * 3_600_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  if (!cache.has(day)) cache.set(day, get(`${ESPN}/scoreboard?dates=${day}`));
  const sb = await cache.get(day);
  for (const ev of sb?.events ?? []) {
    const c = ev.competitions?.[0];
    const home = c?.competitors?.find((x) => x.homeAway === "home");
    const away = c?.competitors?.find((x) => x.homeAway === "away");
    if (
      norm(home?.team?.displayName) !== norm(f.home) ||
      norm(away?.team?.displayName) !== norm(f.away)
    )
      continue;
    if (ev.status?.type?.completed !== true) return { pending: true };
    const ls = (t) => (t?.linescores ?? []).map((x) => Number(x.value ?? x.displayValue ?? 0));
    return { home: ls(home), away: ls(away) };
  }
  return null;
}

/** Wins / losses for a flag from line scores ("win" | "loss" | "push"). */
export function gradeFlag(f, ls) {
  const h = ls.home;
  const a = ls.away;
  if (h.length < 4 || a.length < 4) return null;
  const sum = (x, n) => x.slice(0, n).reduce((s, v) => s + v, 0);
  const v = {
    "1q|ou|all": h[0] + a[0],
    "1h|ou|all": sum(h, 2) + sum(a, 2),
    "2h|ou|all": sum(h, 99) - sum(h, 2) + sum(a, 99) - sum(a, 2),
    "1h|ou|home": sum(h, 2),
    "1h|ou|away": sum(a, 2),
    "game|ou|home": sum(h, 99),
    "game|ou|away": sum(a, 99),
    "1h|sp|": sum(h, 2) - sum(a, 2),
    "1q|sp|": h[0] - a[0],
    "1h|ml|": sum(h, 2) - sum(a, 2),
    "1q|ml|": h[0] - a[0],
  }[f.key];
  if (v == null) return null;
  f.actual = v;
  const bet = f.key.split("|")[1];
  let x;
  if (bet === "ou") x = (v - f.line) * (f.side === "over" ? 1 : -1);
  else if (bet === "sp") x = (v + f.line) * (f.side === "home" ? 1 : -1);
  else x = v * (f.side === "home" ? 1 : -1);
  return x > 0 ? "win" : x < 0 ? "loss" : "push";
}

function record(flags) {
  const r = { watch: [0, 0, 0, 0], track: [0, 0, 0, 0] };
  const byMarket = {};
  for (const f of flags) {
    if (!f.res || f.res === "void") continue;
    for (const x of [r[f.tier], (byMarket[f.key] ??= [0, 0, 0, 0])]) {
      if (f.res === "win") {
        x[0] += 1;
        x[3] += payout(f.price);
      } else if (f.res === "loss") {
        x[0 + 1] += 1;
        x[3] -= 1;
      } else x[2] += 1;
    }
  }
  for (const x of [...Object.values(r), ...Object.values(byMarket)])
    x[3] = Math.round(x[3] * 100) / 100;
  return { ...r, byMarket };
}

async function main() {
  const now = Date.now();
  const OUT = opt("out", "site");
  const markets = JSON.parse(
    await readFile(opt("markets", join(OUT, "markets/nfl.json")), "utf8").catch(() => "{}"),
  );
  const season = nflSeason(new Date(now).toISOString());
  const path = join(OUT, "nfl", `partials-${season}.json`);
  let file = { season, flags: [] };
  try {
    file = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // first run
  }
  const rows = await history();
  const have = new Set(file.flags.map((f) => f.id));
  let added = 0;
  if (!args.includes("--no-flag")) {
    for (const g of markets.games ?? []) {
      if (Date.parse(g.commence) <= now) continue;
      for (const e of edgesFor(g, rows)) {
        if (e.ev < MIN_EV) continue;
        const id = `${g.away}|${g.home}|${String(g.commence).slice(0, 10)}|${e.key}`;
        if (have.has(id)) continue;
        have.add(id);
        added += 1;
        const [label, watch] = MARKETS[e.key];
        file.flags.push({
          id,
          key: e.key,
          label,
          start: g.commence,
          home: g.home,
          away: g.away,
          side: sideName(e.key, e.side),
          line: e.line,
          book: e.book,
          price: e.price,
          ev: Math.round(e.ev * 1000) / 1000,
          chance: Math.round(e.chance * 1000) / 1000,
          full: g.full,
          tier: watch ? "watch" : "track",
          at: new Date(now).toISOString(),
        });
      }
    }
  }
  const cache = new Map();
  let graded = 0;
  for (const f of file.flags) {
    if (f.res || Date.parse(f.start) > now - 4 * 3_600_000) continue;
    const ls = await lineScores(f, cache);
    if (!ls) {
      if (now - Date.parse(f.start) > 4 * 86_400_000) f.res = "void";
      continue;
    }
    if (ls.pending) continue;
    const res = gradeFlag(f, ls);
    if (res) {
      f.res = res;
      graded += 1;
    }
  }
  file.flags.sort((a, b) => a.start.localeCompare(b.start) || b.ev - a.ev);
  file.record = record(file.flags);
  file.updated = new Date(now).toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file));
  console.log(
    `${added} new flags, ${graded} graded → ${path}; record ${JSON.stringify(file.record.watch)} watch, ${JSON.stringify(file.record.track)} track`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
