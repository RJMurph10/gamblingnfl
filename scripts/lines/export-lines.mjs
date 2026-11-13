#!/usr/bin/env node
/**
 * Game lines for any ESPN league: every finished game (or fight) in a date range with its score and every
 * book's lines from ESPN's core odds feed (moneyline, spread, total, with opening and closing prices where
 * ESPN kept them). For leagues the site doesn't save lines for yet (soccer beyond MLS, college baseball,
 * UFL, UFC…). Runs in GitHub Actions (.github/workflows/lines-history.yml).
 *
 *   node scripts/lines/export-lines.mjs --sport soccer --league eng.1 --from 2023-11-01 --to 2026-11-12 --out out
 *     [--upcoming: also games not started yet, with their current lines]
 *     → out/<league>/<season year>.jsonl.gz
 *
 * Row: { id, comp, date, season, type, name, status,
 *        teams: [{ id, abbr, name, homeAway, score, winner }],
 *        books: [{ id, name, ...ESPN's odds object (open / close / current blocks kept as ESPN sends them) }] }
 * ESPN's odds objects differ by sport (soccer has drawOdds, UFC is a two-fighter moneyline), so they're
 * kept close to raw: only links and $ref noise are dropped.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const SPORT = opt("sport");
const LEAGUE = opt("league");
const FROM = opt("from", "2023-11-01");
const TO = opt("to", new Date().toISOString().slice(0, 10));
const OUT = opt("out", "out");
const QUERY = opt("query", "");
const UPCOMING = args.includes("--upcoming"); // also games not played yet (their current lines)
if (!SPORT || !LEAGUE) throw new Error("--sport and --league are required");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.espn.com/",
};
let requests = 0;
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
/** Run fn over items, n at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Drop links and $ref fields, recursively. */
function clean(x) {
  if (Array.isArray(x)) return x.map(clean);
  if (!x || typeof x !== "object") return x;
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === "$ref" || k === "links" || k === "link" || k === "logos" || k === "propBets")
      continue;
    o[k] = clean(v);
  }
  return o;
}
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const SITE = `https://site.api.espn.com/apis/site/v2/sports/${SPORT}/${LEAGUE}`;
const CORE = `https://sports.core.api.espn.com/v2/sports/${SPORT}/leagues/${LEAGUE}`;

// 1. every finished competition, one scoreboard request per day
const days = [];
for (let t = Date.parse(`${FROM}T12:00:00Z`); t <= Date.parse(`${TO}T12:00:00Z`); t += 86_400_000)
  days.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, ""));
const comps = new Map();
await pool(days, 8, async (d) => {
  const sb = await get(`${SITE}/scoreboard?dates=${d}&limit=500${QUERY ? `&${QUERY}` : ""}`);
  for (const e of sb?.events ?? [])
    for (const c of e.competitions ?? []) {
      const done = c.status?.type?.completed;
      if (!done && !(UPCOMING && c.status?.type?.state === "pre")) continue;
      const key = `${e.id}/${c.id}`;
      if (comps.has(key)) continue;
      comps.set(key, {
        id: String(e.id),
        comp: String(c.id),
        date: c.date ?? e.date,
        season: e.season?.year ?? Number(String(e.date).slice(0, 4)),
        type: e.season?.type ?? null,
        name: e.name ?? "",
        status: c.status?.type?.name ?? "",
        state: c.status?.type?.state ?? "",
        teams: (c.competitors ?? []).map((k) => ({
          id: String(k.team?.id ?? k.athlete?.id ?? k.id ?? ""),
          abbr: k.team?.abbreviation ?? k.athlete?.shortName ?? "",
          name: k.team?.displayName ?? k.athlete?.displayName ?? "",
          homeAway: k.homeAway ?? null,
          score: num(k.score?.value ?? k.score),
          winner: k.winner ?? null,
        })),
      });
    }
});

// 2. every book's odds for each competition
const list = [...comps.values()].sort((a, b) => a.date.localeCompare(b.date));
await pool(list, 8, async (g) => {
  const odds = await get(`${CORE}/events/${g.id}/competitions/${g.comp}/odds?limit=50`);
  const books = [];
  for (const it of odds?.items ?? []) {
    const o = it?.provider ? it : it?.$ref ? await get(it.$ref) : null;
    if (!o) continue;
    const pid = String(o.provider?.id ?? /\/odds\/(\d+)/.exec(it?.$ref ?? "")?.[1] ?? "");
    // in-game feeds ("ESPN BET - Live Odds", "Caesars Sportsbook (NJ)-Live") kept updating during the game
    if (/\blive\b/i.test(o.provider?.name ?? "")) continue;
    books.push({ id: pid, ...clean(o), provider: undefined, name: o.provider?.name ?? "" });
  }
  g.books = books;
});

// 3. one file per season
const bySeason = new Map();
for (const g of list) {
  const k = String(g.season);
  if (!bySeason.has(k)) bySeason.set(k, []);
  bySeason.get(k).push(g);
}
await mkdir(join(OUT, LEAGUE), { recursive: true });
for (const [season, rows] of bySeason) {
  await writeFile(
    join(OUT, LEAGUE, `${season}.jsonl.gz`),
    gzipSync(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { level: 9 }),
  );
  const withOdds = rows.filter((r) => r.books.length);
  const withOpen = rows.filter((r) =>
    r.books.some((b) => b.open || b.homeTeamOdds?.open || b.awayTeamOdds?.open),
  );
  const books = {};
  for (const r of rows) for (const b of r.books) books[b.name] = (books[b.name] ?? 0) + 1;
  console.log(
    `${LEAGUE} ${season}: ${rows.length} games, ${withOdds.length} with lines, ${withOpen.length} with openers ${JSON.stringify(books)}`,
  );
}
console.log(`${LEAGUE}: ${list.length} games, ${requests} requests`);
