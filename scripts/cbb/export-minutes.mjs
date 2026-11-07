#!/usr/bin/env node
/**
 * Every Division I men's player's minutes by team for one season (ESPN box scores), for roster-continuity
 * research (returning minutes, transfers). Games come from ESPN's daily scoreboard (all D-I, groups=50).
 *   <out>/cbb-minutes-<season>.json  { season, games, teams: { teamId: { athleteId: [name, minutes, games] } } }
 *
 *   node scripts/cbb/export-minutes.mjs 2024 out     (2024 = the 2024-25 season)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const YEAR = Number(process.argv[2]);
const OUT = process.argv[3] ?? "out";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json" };
let requests = 0, fails = 0;
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    requests += 1;
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(25_000) });
      if (r.ok) return await r.json();
      if (fails++ < 5) console.log(`HTTP ${r.status} ${url.slice(0, 110)}`);
      if (r.status === 404) return null;
    } catch (e) {
      if (fails++ < 5) console.log(`error ${String(e).slice(0, 80)}`);
    }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

async function main() {
  const label = `${YEAR}-${String((YEAR + 1) % 100).padStart(2, "0")}`;
  const ids = new Set();
  const end = new Date(Math.min(Date.UTC(YEAR + 1, 3, 15), Date.now()));
  for (let d = new Date(Date.UTC(YEAR, 10, 1)); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10).replace(/-/g, "");
    const sb = await get(`${SITE}/scoreboard?dates=${day}&groups=50&limit=400`);
    for (const e of sb?.events ?? []) if (e?.competitions?.[0]?.status?.type?.completed) ids.add(e.id);
  }
  const teams = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(
      list.slice(i, i + 4).map(async (id) => {
        const s = await get(`${SITE}/summary?event=${id}`);
        for (const t of s?.boxscore?.players ?? []) {
          const tid = String(t?.team?.id ?? "");
          if (!tid) continue;
          const st = t?.statistics?.[0];
          const mi = (st?.names ?? st?.labels ?? []).findIndex((x) => /^MIN$/i.test(x));
          if (mi < 0) continue;
          for (const a of st?.athletes ?? []) {
            const aid = String(a?.athlete?.id ?? "");
            const min = Number(a?.stats?.[mi]);
            if (!aid || !Number.isFinite(min) || min <= 0) continue;
            const row = ((teams[tid] ??= {})[aid] ??= [a.athlete.displayName ?? "", 0, 0]);
            row[1] += min;
            row[2] += 1;
          }
        }
      }),
    );
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `cbb-minutes-${label}.json`), JSON.stringify({ season: label, games: list.length, teams }));
  console.log(`${label}: ${list.length} games, ${Object.keys(teams).length} teams; ${requests} requests, ${fails} failures`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
