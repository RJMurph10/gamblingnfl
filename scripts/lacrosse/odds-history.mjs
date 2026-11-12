#!/usr/bin/env node
/**
 * Historical lacrosse game lines (moneyline, spread, total; US books) from The Odds API, for a one-month
 * paid plan: PLL (lacrosse_pll, from May 2024) and men's college (lacrosse_ncaa, from May 2023).
 *
 * Each historical snapshot returns every game on the board at that moment and costs
 * 10 × 3 markets × 1 region = 30 credits. Game times come from ESPN (free), and one snapshot is taken
 * shortly before each cluster of start times on a game day: the closing lines for those games, and an
 * earlier look at games later in the week (a game's first appearance across snapshots = its opener).
 * Game days with no snapshot in the 48 hours before also get one 2 days early (PLL weekends).
 *
 * Snapshots are saved raw, one file each: <out>/<sport>/<YYYY-MM-DDTHH-MM>.json. Files already there
 * are skipped, so a rerun never pays twice. Stops when the key's remaining credits fall under --reserve.
 *
 *   node scripts/lacrosse/odds-history.mjs --sport lacrosse_pll --from 2024-05-01 --to 2026-09-30 --dry
 *   ODDS_API_KEY=... node scripts/lacrosse/odds-history.mjs --sport lacrosse_ncaa --from 2023-05-01 \
 *     --to 2026-06-01 --out data --reserve 500
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const SPORT = opt("sport", "lacrosse_pll");
const FROM = opt("from", "2024-05-01");
const TO = opt("to", new Date().toISOString().slice(0, 10));
const OUT = opt("out", "data");
const DRY = args.includes("--dry");
const RESERVE = Number(opt("reserve", "500"));
const KEY = process.env.ODDS_API_KEY;
export const COST = 30; // 10 (historical) × 3 markets × 1 region
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Games starting within this long of a cluster's first game share its snapshot. */
export const CLUSTER = 3 * HOUR;
/** A snapshot this long before the cluster's first game (lines are close to final). */
export const LEAD = 10 * 60_000;

const ESPN = {
  lacrosse_pll: "pll",
  lacrosse_ncaa: "mens-college-lacrosse",
};

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return { json: await r.json(), headers: r.headers };
      if (r.status === 404 || r.status === 422) return { json: null, headers: r.headers, status: r.status };
      if (r.status === 401 || r.status === 429) throw new Error(`${r.status} ${await r.text()}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return { json: null };
}

const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");

/** Every scheduled game's start time from ESPN, a week at a time (longer ranges return 400). */
async function gameTimes(league, from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 7 * DAY) {
    const end = Math.min(t + 6 * DAY, Date.parse(`${to}T00:00:00Z`));
    const { json } = await getJson(
      `https://site.api.espn.com/apis/site/v2/sports/lacrosse/${league}/scoreboard?dates=${ymd(t)}-${ymd(end)}&limit=500`,
    );
    for (const e of json?.events ?? []) {
      const d = Date.parse(e.date);
      if (Number.isFinite(d)) out.push(d);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Snapshot times for a sorted list of start times: one LEAD before each cluster (games within CLUSTER
 * of the cluster's first), plus one 2 days before any game day with no snapshot in the 48 hours before
 * it (so weekend-only leagues get an early look). Sorted, no duplicates.
 */
export function snapshotTimes(starts) {
  const snaps = [];
  let i = 0;
  while (i < starts.length) {
    const first = starts[i];
    snaps.push(first - LEAD);
    while (i < starts.length && starts[i] - first <= CLUSTER) i += 1;
  }
  const early = [];
  for (const s of snaps) {
    const before = snaps.some((x) => x < s && s - x <= 2 * DAY) || early.some((x) => x < s && s - x <= 2 * DAY);
    if (!before) early.push(s - 2 * DAY);
  }
  // round to the minute so file names are stable across reruns
  return [...new Set([...snaps, ...early].map((t) => Math.floor(t / 60_000) * 60_000))].sort((a, b) => a - b);
}

const fileFor = (t) => `${new Date(t).toISOString().slice(0, 16).replace(":", "-")}.json`;

async function main() {
  const league = ESPN[SPORT];
  if (!league) throw new Error(`unknown sport ${SPORT}`);
  const starts = await gameTimes(league, FROM, TO);
  const snaps = snapshotTimes(starts);
  const dir = join(OUT, SPORT);
  await mkdir(dir, { recursive: true });
  const have = new Set(await readdir(dir).catch(() => []));
  const todo = snaps.filter((t) => !have.has(fileFor(t)) && t < Date.now());
  console.log(
    `${SPORT} ${FROM}..${TO}: ${starts.length} games, ${snaps.length} snapshots (${todo.length} to pull), ` +
      `up to ${todo.length * COST} credits`,
  );
  if (DRY) return;
  if (!KEY) {
    console.log("ODDS_API_KEY is not set; nothing pulled.");
    return;
  }
  let pulled = 0;
  let games = 0;
  for (const t of todo) {
    const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    const url =
      `https://api.the-odds-api.com/v4/historical/sports/${SPORT}/odds?apiKey=${KEY}` +
      `&regions=us&markets=h2h,spreads,totals&oddsFormat=american&date=${iso}`;
    const { json, headers } = await getJson(url);
    const left = Number(headers?.get?.("x-requests-remaining"));
    if (json) {
      await writeFile(join(dir, fileFor(t)), JSON.stringify(json));
      pulled += 1;
      games += json.data?.length ?? 0;
    }
    if (Number.isFinite(left) && left < RESERVE) {
      console.log(`stopping: ${left} credits left (reserve ${RESERVE})`);
      break;
    }
    if (pulled % 25 === 0) console.log(`${pulled} snapshots, ${left} credits left`);
  }
  console.log(`${SPORT}: pulled ${pulled} snapshots (${games} game boards)`);
}

if (process.argv[1]?.endsWith("odds-history.mjs"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
