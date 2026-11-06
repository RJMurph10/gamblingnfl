#!/usr/bin/env node
/**
 * NHL games with goals and shots by period and the goalies who played (starter flagged), from the NHL's free
 * stats site (api-web.nhle.com). For period-total models (1st-period over/under).
 *   <out>/nhl-periods-<season>.jsonl.gz, one JSON line per game:
 *   { id, season, type, date, start, home, away, final: [home, away],
 *     goals: { home: [p1, p2, p3, ot...], away: [...] }, shots: { home: [...], away: [...] },
 *     goalies: { home: [[playerId, name, starter, toi, shotsAgainst, goalsAgainst]], away: [...] } }
 *
 *   node scripts/nhl/export-periods.mjs --from 2024-10-01 --to 2025-06-30 --season 2024-25 --out out
 *   node scripts/nhl/export-periods.mjs --probe 2025020001     (prints the raw shapes for one game)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = "https://api-web.nhle.com/v1";
let requests = 0;
async function get(path) {
  for (let i = 0; i < 4; i += 1) {
    requests += 1;
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { "User-Agent": "gamblingnfl-nhl-periods" }, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const shape = (o, depth = 0, pre = "") => {
  if (depth > 3 || o == null || typeof o !== "object") return [];
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    const p = pre ? `${pre}.${k}` : k;
    out.push(`${p}: ${Array.isArray(v) ? `array(${v.length})` : typeof v}`);
    if (Array.isArray(v) && v[0] && typeof v[0] === "object") out.push(...shape(v[0], depth + 1, `${p}[0]`));
    else if (v && typeof v === "object" && !Array.isArray(v)) out.push(...shape(v, depth + 1, p));
  }
  return out;
};

const per = (n) => Math.max(0, Number(n) - 1);
function perPeriod(list, side) {
  // [{ periodDescriptor: { number }, away, home }] → [p1, p2, ...]
  const out = [];
  for (const x of list ?? []) {
    const n = x?.periodDescriptor?.number ?? x?.period;
    const v = Number(x?.[side]);
    if (Number.isFinite(n) && Number.isFinite(v)) out[per(n)] = v;
  }
  return out.map((v) => v ?? 0);
}

function goalsFromScoring(scoring, abbr) {
  const out = [];
  for (const p of scoring ?? []) {
    const n = per(p?.periodDescriptor?.number);
    out[n] = (out[n] ?? 0) + (p?.goals ?? []).filter((g) => (g?.teamAbbrev?.default ?? g?.teamAbbrev) === abbr).length;
  }
  return Array.from(out, (v) => v ?? 0);
}

async function game(id) {
  const [box, rail, land] = await Promise.all([get(`/gamecenter/${id}/boxscore`), get(`/gamecenter/${id}/right-rail`), get(`/gamecenter/${id}/landing`)]);
  if (!box) return null;
  const home = box.homeTeam?.abbrev, away = box.awayTeam?.abbrev;
  const lineBy = rail?.linescore?.byPeriod ?? land?.summary?.linescore?.byPeriod;
  const goals = lineBy
    ? { home: perPeriod(lineBy, "home"), away: perPeriod(lineBy, "away") }
    : { home: goalsFromScoring(land?.summary?.scoring, home), away: goalsFromScoring(land?.summary?.scoring, away) };
  const sbp = rail?.shotsByPeriod ?? land?.summary?.shotsByPeriod;
  const shots = sbp ? { home: perPeriod(sbp, "home"), away: perPeriod(sbp, "away") } : null;
  const gk = (side) =>
    (box.playerByGameStats?.[side]?.goalies ?? []).map((g) => [
      String(g.playerId),
      g.name?.default ?? "",
      !!g.starter,
      g.toi ?? null,
      g.shotsAgainst ?? null,
      g.goalsAgainst ?? null,
    ]);
  return {
    id: String(id),
    season: String(box.season ?? ""),
    type: box.gameType,
    date: box.gameDate,
    start: box.startTimeUTC,
    home,
    away,
    final: [box.homeTeam?.score ?? null, box.awayTeam?.score ?? null],
    goals,
    shots,
    goalies: { home: gk("homeTeam"), away: gk("awayTeam") },
  };
}

async function main() {
  const probe = opt("probe");
  if (probe) {
    for (const p of ["boxscore", "right-rail", "landing"]) {
      const d = await get(`/gamecenter/${probe}/${p}`);
      console.log(`--- ${p}`);
      console.log(shape(d).filter((l) => /score|shot|period|goal|linescore|starter|toi/i.test(l)).slice(0, 60).join("\n"));
    }
    console.log(JSON.stringify(await game(probe)));
    return;
  }
  const from = opt("from"), to = opt("to"), season = opt("season"), OUT = opt("out", "out");
  const ids = new Map();
  let day = from;
  while (day && day <= to) {
    const s = await get(`/schedule/${day}`);
    for (const w of s?.gameWeek ?? [])
      for (const g of w.games ?? []) if ([2, 3].includes(g.gameType) && g.gameState && /OFF|FINAL/.test(g.gameState)) ids.set(g.id, w.date);
    const next = s?.nextStartDate;
    if (!next || next <= day) break;
    day = next;
  }
  const games = [];
  const list = [...ids.keys()];
  for (let i = 0; i < list.length; i += 6) {
    const chunk = await Promise.all(list.slice(i, i + 6).map(game));
    games.push(...chunk.filter(Boolean));
  }
  games.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `nhl-periods-${season}.jsonl.gz`), gzipSync(games.map((g) => JSON.stringify(g)).join("\n") + "\n"));
  const withShots = games.filter((g) => g.shots).length;
  const withStarter = games.filter((g) => g.goalies.home.some((x) => x[2]) && g.goalies.away.some((x) => x[2])).length;
  console.log(`${season}: ${games.length} games (${withShots} with shots by period, ${withStarter} with both starters flagged); ${requests} requests`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
