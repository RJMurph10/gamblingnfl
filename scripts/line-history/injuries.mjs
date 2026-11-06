#!/usr/bin/env node
/**
 * Injury reports from ESPN, saved whenever they change, so models can later be tested on who was out and
 * when the news broke (e.g. did the opening total already know a star was sitting?).
 *   <out>/injuries/<league>/<YYYY-MM-DD>.json  (Eastern day)
 *   { league, snapshots: [{ at, players: { athleteId: [name, team, position, status, type, detail, returnDate, reported] } }] }
 * A snapshot is added only when the report differs from the last one saved (same day or the day before).
 *
 *   node scripts/line-history/injuries.mjs --out data
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data";
const LEAGUES = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  nhl: "hockey/nhl",
  mlb: "baseball/mlb",
  cfb: "football/college-football",
  cbb: "basketball/mens-college-basketball",
  wcbb: "basketball/womens-college-basketball",
};

async function get(url) {
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gamblingnfl-line-history" } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

const etDay = (t) => new Date(t - 5 * 3_600_000).toISOString().slice(0, 10);
const str = (v) => (v == null ? "" : String(v));

async function lastSaved(dir, now) {
  for (const day of [etDay(now), etDay(now - 86_400_000)]) {
    try {
      const f = JSON.parse(await readFile(join(dir, `${day}.json`), "utf8"));
      const s = f.snapshots?.[f.snapshots.length - 1];
      if (s) return s.players;
    } catch {
      // none that day
    }
  }
  return null;
}

async function main() {
  const now = Date.now();
  const summary = [];
  for (const [league, path] of Object.entries(LEAGUES)) {
    const json = await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/injuries`);
    const players = {};
    for (const team of json?.injuries ?? []) {
      const teamAbbr = str(team.abbreviation ?? team.team?.abbreviation ?? team.displayName);
      for (const inj of team.injuries ?? []) {
        const a = inj.athlete ?? {};
        const id = str(a.id ?? inj.id);
        if (!id) continue;
        const d = inj.details ?? {};
        players[id] = [
          str(a.displayName ?? a.fullName),
          str(a.team?.abbreviation ?? teamAbbr),
          str(a.position?.abbreviation),
          str(inj.status ?? inj.type?.description),
          str(d.type ?? inj.type?.abbreviation),
          [d.side, d.location, d.detail].filter(Boolean).join(" "),
          str(d.returnDate),
          str(inj.date),
        ];
      }
    }
    const n = Object.keys(players).length;
    if (!n) {
      summary.push(`${league}: none`);
      continue;
    }
    const dir = join(OUT, "injuries", league);
    await mkdir(dir, { recursive: true });
    const prev = await lastSaved(dir, now);
    if (prev && JSON.stringify(prev) === JSON.stringify(players)) {
      summary.push(`${league}: ${n} (unchanged)`);
      continue;
    }
    const file = join(dir, `${etDay(now)}.json`);
    let f = { league, snapshots: [] };
    try {
      f = JSON.parse(await readFile(file, "utf8"));
    } catch {
      // first snapshot of the day
    }
    f.snapshots.push({ at: new Date(now).toISOString(), players });
    await writeFile(file, JSON.stringify(f));
    summary.push(`${league}: ${n} (saved)`);
  }
  console.log(`injuries: ${summary.join("; ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(0); // never fail the line saver over injuries
});
