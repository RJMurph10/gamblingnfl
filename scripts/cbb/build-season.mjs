#!/usr/bin/env node
/**
 * The men's (or, with --league wcbb, women's) college basketball season for the site, as one file on
 * the props-site branch:
 *   <out>/<league>/season-<YYYY-YY>.json
 *   { updated, season, conferences: { id: [name, short] },
 *     teams: { id: [abbr, name, short, nickname, color, logo, confId] },
 *     games: [[id, date, homeId, homeScore, awayId, awayScore, neutral, conf, type, line|null, note, location]] }
 *   lines: { gameId: line }  (pregame lines of live and upcoming games, yesterday through next week)
 *   opens: { gameId: [homeSpread, total] }  (their opening lines)
 * game rows end with possessions (from the box score) and the opening [homeSpread, total]
 * line = [homeSpread, total, mlHome, mlAway, spreadOddsHome, spreadOddsAway, overOdds, underOdds]
 *
 * Finished games only (the site reads live and upcoming games straight from ESPN). Closing lines come
 * from the hourly line saver's files (line-history branch); a game it missed is looked up on ESPN once.
 * Runs hourly in .github/workflows/line-history.yml.
 *
 *   node scripts/cbb/build-season.mjs --data data-repo/data --out site-repo [--league wcbb]
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bestLine, openLine } from "./lines.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const DATA = opt("data", "data");
const OUT = opt("out", "props-site");
const LOOKUPS = Number(opt("lookups", "400"));
const POSS_LOOKUPS = Number(opt("possessions", "400"));
const LEAGUE = opt("league", "cbb");
const ESPN_LEAGUE = { cbb: "mens-college-basketball", wcbb: "womens-college-basketball" }[LEAGUE];
if (!ESPN_LEAGUE) throw new Error(`unknown league ${LEAGUE}`);
const SITE = `https://site.api.espn.com/apis/site/v2/sports/basketball/${ESPN_LEAGUE}`;
const CORE = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/${ESPN_LEAGUE}`;
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
const path = join(OUT, LEAGUE, `season-${SEASON}.json`);
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const etDay = (iso) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 10);

async function loggerRecord(g) {
  try {
    return JSON.parse(await readFile(join(DATA, LEAGUE, SEASON, `${etDay(g.date)}-${g.id}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** The line saver's closing line for a game. */
function closeOf(rec) {
  const L = rec?.lines ?? {};
  const home = rec?.home;
  return (
    bestLine(L.final?.books, home) ??
    bestLine(L.close?.books, home) ??
    bestLine(L.close?.scoreboard, home) ??
    bestLine(L.open?.books, home) ??
    bestLine(L.open?.scoreboard, home)
  );
}

/** The opening spread and total: ESPN's own opener, else the first line the saver saw. */
function openOf(rec) {
  const L = rec?.lines ?? {};
  const home = rec?.home;
  const first = bestLine(L.open?.books, home) ?? bestLine(L.open?.scoreboard, home);
  return (
    openLine(L.final?.books, home) ??
    openLine(L.close?.books, home) ??
    openLine(L.open?.books, home) ??
    openLine(L.open?.scoreboard, home) ??
    (first ? [first[0], first[1]] : null)
  );
}

async function loggerLine(g) {
  return closeOf(await loggerRecord(g));
}

/** Possessions in a finished game, from its box score (FGA − OREB + TO + 0.475 × FTA, teams averaged). */
async function possessionsOf(id) {
  const s = await get(`${SITE}/summary?event=${id}`);
  const each = [];
  for (const t of s?.boxscore?.teams ?? []) {
    const st = {};
    for (const x of t?.statistics ?? []) st[String(x?.name ?? "")] = String(x?.displayValue ?? "");
    const att = (k) => Number(String(st[k] ?? "").split("-")[1]);
    const one = (...ks) => {
      for (const k of ks) if (st[k] !== undefined && Number.isFinite(Number(st[k]))) return Number(st[k]);
      return NaN;
    };
    const p = att("fieldGoalsMade-fieldGoalsAttempted") - one("offensiveRebounds") + one("totalTurnovers", "turnovers") + 0.475 * att("freeThrowsMade-freeThrowsAttempted");
    if (Number.isFinite(p)) each.push(p);
  }
  if (each.length !== 2) return null;
  const p = (each[0] + each[1]) / 2;
  return p >= 45 && p <= 110 ? Math.round(p * 10) / 10 : null;
}

async function espnLine(id, home) {
  const list = await get(`${CORE}/events/${id}/competitions/${id}/odds?limit=50`);
  const items = [];
  for (const it of list?.items ?? [])
    items.push(it?.$ref && Object.keys(it).length === 1 ? await get(it.$ref) : it);
  return bestLine(items, home);
}

let teamsAbbr = () => "";

async function main() {
  let file = { season: SEASON, conferences: {}, teams: {}, games: [], tried: [] };
  try {
    file = { ...file, ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    // first run of the season
  }
  const games = new Map(file.games.map((g) => [g[0], g]));
  const tried = new Set(file.tried ?? []);
  teamsAbbr = (id) => file.teams[id]?.[0] ?? "";

  // conferences and Division I teams
  const groups = await get(`${SITE}/groups`);
  for (const conf of groups?.groups?.[0]?.children ?? []) {
    const cid = String(conf.id ?? conf.uid?.split("~g:")[1] ?? conf.abbreviation ?? "");
    if (!cid) continue;
    const cname = String(conf.name ?? "");
    file.conferences[cid] = [cname, String(conf.shortName ?? cname.replace(/\s+Conference$/i, ""))];
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
      const addr = comp.venue?.address;
      const location = [addr?.city, addr?.state].filter(Boolean).join(", ");
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
        note ? String(note) : "",
        location,
        games.get(String(e.id))?.[12] ?? null,
        games.get(String(e.id))?.[13] ?? null,
      ];
      games.set(row[0], row);
      finals.push(row);
    }
  }

  // closing lines: the line saver's files first, then ESPN for games it missed (once each)
  let fromLogger = 0;
  let looked = 0;
  // the line saver's copy always wins (it's re-read every run, so a correction reaches old games too)
  for (const row of games.values()) {
    const rec = await loggerRecord({ id: row[0], date: row[1] });
    const l = closeOf(rec);
    if (l) {
      row[9] = l;
      fromLogger += 1;
    }
    const o = openOf(rec);
    while (row.length < 14) row.push(null);
    if (o) row[13] = o;
  }

  // possessions from each finished game's box score (once per game; the model rates per possession)
  let possLooked = 0;
  const needPoss = [...games.values()].filter((r) => r[12] == null && !tried.has(`p${r[0]}`));
  needPoss.sort((x, y) => y[1].localeCompare(x[1]));
  const possBatch = needPoss.slice(0, POSS_LOOKUPS);
  for (let i = 0; i < possBatch.length; i += 10) {
    await Promise.all(
      possBatch.slice(i, i + 10).map(async (row) => {
        possLooked += 1;
        const p = await possessionsOf(row[0]);
        if (p) row[12] = p;
        else if (Date.now() - Date.parse(row[1]) > 3 * 86_400_000) tried.add(`p${row[0]}`);
      }),
    );
  }
  const missing = [...games.values()].filter((r) => !r[9] && !tried.has(r[0]));
  missing.sort((x, y) => y[1].localeCompare(x[1]));
  const batch = missing.slice(0, LOOKUPS);
  for (let i = 0; i < batch.length; i += 8) {
    await Promise.all(
      batch.slice(i, i + 8).map(async (row) => {
        looked += 1;
        const l = await espnLine(row[0], { id: row[2], abbr: teamsAbbr(row[2]) });
        if (l) row[9] = l;
        // ESPN keeps lines a while after the game; give up after three days
        else if (Date.now() - Date.parse(row[1]) > 3 * 86_400_000) tried.add(row[0]);
      }),
    );
  }

  // pregame lines for live and upcoming games (yesterday through next week): ESPN drops a game's line
  // from its scoreboard at tip-off, so the site reads the line saver's last pregame line from here
  file.lines = {};
  file.opens = {};
  const dir = join(DATA, LEAGUE, SEASON);
  const lo = etDay(new Date(now.getTime() - 86_400_000).toISOString());
  const hi = etDay(new Date(now.getTime() + 8 * 86_400_000).toISOString());
  for (const f of await readdir(dir).catch(() => [])) {
    const day = f.slice(0, 10);
    if (!f.endsWith(".json") || day < lo || day > hi) continue;
    try {
      const rec = JSON.parse(await readFile(join(dir, f), "utf8"));
      const L = rec.lines ?? {};
      const h = rec.home;
      const line =
        bestLine(L.close?.books, h) ??
        bestLine(L.close?.scoreboard, h) ??
        bestLine(L.open?.books, h) ??
        bestLine(L.open?.scoreboard, h);
      if (line && rec.id) file.lines[rec.id] = line;
      const o = openOf(rec);
      if (o && rec.id) file.opens[rec.id] = o;
    } catch {
      // skip unreadable files
    }
  }

  file.games = [...games.values()].sort((x, y) => x[1].localeCompare(y[1]) || x[0].localeCompare(y[0]));
  file.tried = [...tried];
  file.updated = now.toISOString();
  await mkdir(join(OUT, LEAGUE), { recursive: true });
  await writeFile(path, JSON.stringify(file));
  const withLine = file.games.filter((g) => g[9]?.[0] != null).length;
  console.log(
    `${LEAGUE} ${SEASON}: ${Object.keys(file.lines).length} live/upcoming lines, ${file.games.length} finished games (${withLine} with a spread; ${fromLogger} from the line saver, ${looked} ESPN lookups, ${possLooked} box scores read), ${Object.keys(file.teams).length} teams, ${Object.keys(file.conferences).length} conferences`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
