#!/usr/bin/env node
/**
 * This season's NBA stars per team, for the star-absence adjustment to totals (src/lib/nba/star-absence.ts).
 * Keeps every finished game's box score (players who played: minutes, points) in <site>/nba/box-<season>.json,
 * fetching only games it doesn't have yet, then writes <site>/nba/stars-<season>.json:
 *   { builtAt, teams: { ESPN abbr: [{ id, name, ppg, missed }] } }
 * A star = over the team's last 15 games, 20+ minutes a game when he plays, 3+ games played, 20+ points a
 * game; `missed` = share of those 15 games he sat (what the team ratings already reflect).
 *
 *   node scripts/picks/nba-stars.mjs <site-dir>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SITE_DIR = process.argv[2] ?? "site";
const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const WINDOW = 15;

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const now = new Date();
const endYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const season = `${endYear - 1}-${String(endYear).slice(2)}`;
const dir = join(SITE_DIR, "nba");
await mkdir(dir, { recursive: true });
const boxFile = join(dir, `box-${season}.json`);
let box = { lastDay: `${endYear - 1}-10-01`, games: {} };
try {
  box = JSON.parse(await readFile(boxFile, "utf8"));
} catch {
  // first run of the season
}

// scoreboards from two days before the last day fetched (late finals, corrections) through today
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
let added = 0;
for (
  let t = Date.parse(`${box.lastDay}T12:00:00Z`) - 2 * 86_400_000;
  t <= now.getTime();
  t += 86_400_000
) {
  const sb = await get(`${API}/scoreboard?dates=${ymd(t).replace(/-/g, "")}`);
  const evs = (sb?.events ?? []).filter(
    (e) =>
      e?.competitions?.[0]?.status?.type?.completed && [2, 3, 5].includes(Number(e?.season?.type)),
  );
  for (const ev of evs) {
    if (box.games[ev.id]) continue;
    const s = await get(`${API}/summary?event=${ev.id}`);
    const teams = {};
    for (const team of s?.boxscore?.players ?? []) {
      const list = [];
      for (const st of team.statistics ?? []) {
        const lab = st.labels ?? st.names ?? [];
        const iMin = lab.indexOf("MIN");
        const iPts = lab.indexOf("PTS");
        for (const a of st.athletes ?? []) {
          const min = Number(a.stats?.[iMin]);
          if (a.didNotPlay || !(min > 0)) continue;
          list.push([
            String(a.athlete?.id ?? ""),
            String(a.athlete?.displayName ?? ""),
            min,
            Number(a.stats?.[iPts]) || 0,
          ]);
        }
      }
      if (team.team?.abbreviation) teams[team.team.abbreviation] = list;
    }
    if (Object.keys(teams).length === 2) {
      box.games[ev.id] = { date: ev.date, teams };
      added++;
    }
  }
  if (t < now.getTime() - 86_400_000) box.lastDay = ymd(t);
}
await writeFile(boxFile, JSON.stringify(box));

// stars per team over its last WINDOW games
const byTeam = new Map();
for (const g of Object.values(box.games))
  for (const [abbr, players] of Object.entries(g.teams))
    byTeam.set(abbr, [...(byTeam.get(abbr) ?? []), { date: g.date, players }]);
const teams = {};
for (const [abbr, list] of byTeam) {
  const recent = list.sort((a, b) => a.date.localeCompare(b.date)).slice(-WINDOW);
  const agg = new Map();
  for (const g of recent)
    for (const [id, name, min, pts] of g.players) {
      const a = agg.get(id) ?? { name, gp: 0, min: 0, pts: 0 };
      a.gp++;
      a.min += min;
      a.pts += pts;
      agg.set(id, a);
    }
  teams[abbr] = [...agg]
    .filter(([, a]) => a.gp >= 3 && a.min / a.gp >= 20 && a.pts / a.gp >= 20)
    .map(([id, a]) => ({
      id,
      name: a.name,
      ppg: Math.round((a.pts / a.gp) * 10) / 10,
      missed: Math.round((1 - a.gp / recent.length) * 100) / 100,
    }))
    .sort((a, b) => b.ppg - a.ppg);
}
await writeFile(
  join(dir, `stars-${season}.json`),
  JSON.stringify({ builtAt: now.toISOString(), teams }),
);
const n = Object.values(teams).reduce((s, l) => s + l.length, 0);
console.log(
  `box scores: +${added} (${Object.keys(box.games).length} total); ${n} stars on ${Object.keys(teams).length} teams`,
);
