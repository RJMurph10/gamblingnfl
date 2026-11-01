#!/usr/bin/env node
/**
 * The men's college basketball season for the site, as one file on the props-site branch:
 *   <out>/cbb/season-<YYYY-YY>.json
 *   { updated, season, conferences: { id: [name, short] },
 *     teams: { id: [abbr, name, short, nickname, color, logo, confId] },
 *     games: [[id, date, homeId, homeScore, awayId, awayScore, neutral, conf, type, line|null, note?]] }
 * line = [homeSpread, total, mlHome, mlAway, spreadOddsHome, spreadOddsAway, overOdds, underOdds]
 *
 * Finished games only (the site reads live and upcoming games straight from ESPN). Closing lines come
 * from the hourly line saver's files (line-history branch); a game it missed is looked up on ESPN once.
 * Runs hourly in .github/workflows/line-history.yml.
 *
 *   node scripts/cbb/build-season.mjs --data data-repo/data --out site-repo
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bestLine } from "./lines.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const DATA = opt("data", "data");
const OUT = opt("out", "props-site");
const LOOKUPS = Number(opt("lookups", "400"));
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball";
const H = { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" };

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  return null;
}

const now = new Date();
// the season starts in November; until July it's the season that started the year before
const YEAR = now.getUTCMonth() + 1 <= 7 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
const SEASON = `${YEAR}-${String(YEAR + 1).slice(2)}`;
const path = join(OUT, "cbb", `season-${SEASON}.json`);
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const etDay = (iso) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10);

async function loggerLine(g) {
  const file = join(DATA, "cbb", SEASON, `${etDay(g.date)}-${g.id}.json`);
  let rec;
  try {
    rec = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  const L = rec.lines ?? {};
  return (
    bestLine(L.final?.books) ??
    bestLine(L.close?.books) ??
    bestLine(L.close?.scoreboard) ??
    bestLine(L.open?.books) ??
    bestLine(L.open?.scoreboard)
  );
}

async function espnLine(id) {
  const list = await get(`${CORE}/events/${id}/competitions/${id}/odds?limit=50`);
  const items = [];
  for (const it of list?.items ?? [])
    items.push(it?.$ref && Object.keys(it).length === 1 ? await get(it.$ref) : it);
  return bestLine(items);
}

async function main() {
  let file = { season: SEASON, conferences: {}, teams: {}, games: [], tried: [] };
  try {
    file = { ...file, ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    // first run of the season
  }
  const games = new Map(file.games.map((g) => [g[0], g]));
  const tried = new Set(file.tried ?? []);

  // conferences and Division I teams
  const groups = await get(`${SITE}/groups`);
  for (const conf of groups?.groups?.[0]?.children ?? []) {
    const cid = String(conf.id ?? conf.uid?.split("~g:")[1] ?? conf.abbreviation ?? "");
    if (!cid) continue;
    file.conferences[cid] = [String(conf.name ?? ""), String(conf.shortName ?? conf.abbreviation ?? "")];
    for (const t of conf.teams ?? []) {
      file.teams[t.id] = [
        String(t.abbreviation ?? ""),
        String(t.displayName ?? ""),
        String(t.shortDisplayName ?? ""),
        String(t.name ?? ""),
        String(t.color ?? ""),
        String(t.logos?.[0]?.href ?? ""),
        cid,
      ];
    }
  }

  // days to read: the whole season on the first run, then the last five days
  const start = Date.UTC(YEAR, 10, 1);
  const from = games.size ? Math.max(start, now.getTime() - 5 * 86_400_000) : start;
  const finals = [];
  for (let t = from; t <= now.getTime(); t += 86_400_000) {
    const sb = await get(`${SITE}/scoreboard?dates=${ymd(t)}&groups=50&limit=1000`);
    for (const e of sb?.events ?? []) {
      const comp = e?.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;
      const side = (x) => comp.competitors?.find((c) => c.homeAway === x);
      const h = side("home");
      const a = side("away");
      if (!h?.team?.id || !a?.team?.id) continue;
      for (const c of [h, a]) {
        const tm = c.team;
        if (!file.teams[tm.id])
          file.teams[tm.id] = [
            String(tm.abbreviation ?? ""),
            String(tm.displayName ?? ""),
            String(tm.shortDisplayName ?? tm.location ?? ""),
            String(tm.name ?? ""),
            String(tm.color ?? ""),
            String(tm.logo ?? ""),
            tm.conferenceId != null ? String(tm.conferenceId) : "",
          ];
      }
      const note = comp.notes?.[0]?.headline;
      const row = [
        String(e.id),
        String(e.date),
        String(h.team.id),
        Number(h.score),
        String(a.team.id),
        Number(a.score),
        comp.neutralSite ? 1 : 0,
        comp.conferenceCompetition ? 1 : 0,
        Number(e?.season?.type ?? 2),
        games.get(String(e.id))?.[9] ?? null,
        ...(note ? [String(note)] : []),
      ];
      games.set(row[0], row);
      finals.push(row);
    }
  }

  // closing lines: the line saver's files first, then ESPN for games it missed (once each)
  let fromLogger = 0;
  let looked = 0;
  for (const row of games.values()) {
    if (row[9]) continue;
    const l = await loggerLine({ id: row[0], date: row[1] });
    if (l) {
      row[9] = l;
      fromLogger += 1;
    }
  }
  const missing = [...games.values()].filter((r) => !r[9] && !tried.has(r[0]));
  missing.sort((x, y) => y[1].localeCompare(x[1]));
  const batch = missing.slice(0, LOOKUPS);
  for (let i = 0; i < batch.length; i += 8) {
    await Promise.all(
      batch.slice(i, i + 8).map(async (row) => {
        looked += 1;
        const l = await espnLine(row[0]);
        if (l) row[9] = l;
        // ESPN keeps lines a while after the game; give up after three days
        else if (Date.now() - Date.parse(row[1]) > 3 * 86_400_000) tried.add(row[0]);
      }),
    );
  }

  file.games = [...games.values()].sort((x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]));
  file.tried = [...tried];
  file.updated = now.toISOString();
  await mkdir(join(OUT, "cbb"), { recursive: true });
  await writeFile(path, JSON.stringify(file));
  const withLine = file.games.filter((g) => g[9]?.[0] != null).length;
  console.log(
    `cbb ${SEASON}: ${file.games.length} finished games (${withLine} with a spread; ${fromLogger} from the line saver, ${looked} ESPN lookups), ${Object.keys(file.teams).length} teams, ${Object.keys(file.conferences).length} conferences`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
