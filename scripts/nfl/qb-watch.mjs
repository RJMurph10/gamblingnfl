#!/usr/bin/env node
/**
 * QB news watch (NFL). Runs every 10 minutes during the season:
 *   1. finds each team's regular starting QB (most starts in its last 4 games, from nflverse),
 *   2. reads ESPN's live injury report for that QB (Active / Questionable / Doubtful / Out / IR),
 *   3. logs every status change with the time and DraftKings' spread at that moment,
 *   4. keeps tracking the spread until kickoff, so you can see if (and when) the line caught up.
 * The site shows it as the "QB news" panel (it adds the expected line move from its QB ratings).
 *
 *   node scripts/nfl/qb-watch.mjs --season 2026 --out site-repo
 *   → <out>/nfl/qb-watch-2026.json
 *   { updatedAt, starters: {team: {qb, name}}, status: {team: {status, since}},
 *     events: [{ id, team, qb, name, from, to, at, game: {id, name, kickoff, home, away},
 *                open, atNews, now, track: [[at, spread]] }] }
 * Spreads are the TEAM's own (negative = favored), so a starter going out should push it up.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const SEASON = Number(opt("--season", new Date().getUTCFullYear() - (new Date().getUTCMonth() < 6 ? 1 : 0)));
const OUT = opt("--out", "out");
const FILE = join(OUT, "nfl", `qb-watch-${SEASON}.json`);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const GAMES_CSV = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
// nflverse → ESPN team abbreviations
const TEAM = { LA: "LAR", WAS: "WSH" };
const espnAbbr = (t) => TEAM[t] ?? t;

async function get(url, json = true) {
  for (let i = 0; i < 3; i += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gamblingnfl-qb-watch" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return json ? await res.json() : await res.text();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
const LEVEL = { active: 0, questionable: 1, doubtful: 2, out: 3, "injured reserve": 3, suspension: 3, "physically unable to perform": 3 };
const level = (s) => LEVEL[String(s ?? "").toLowerCase()] ?? (s ? 1 : 0);

/** Regular starter per team: most starts in its last 4 games this season (latest breaks ties). */
async function regularStarters() {
  const csv = await get(GAMES_CSV, false);
  if (!csv) return null;
  const [head, ...rows] = csv.trim().split("\n");
  const h = head.split(",");
  const ix = (k) => h.indexOf(k);
  const starts = new Map();
  for (const line of rows) {
    const f = line.split(",");
    if (Number(f[ix("season")]) !== SEASON || f[ix("game_type")] !== "REG" || f[ix("home_score")] === "") continue;
    const wk = Number(f[ix("week")]);
    for (const side of ["home", "away"]) {
      const team = espnAbbr(f[ix(`${side}_team`)]);
      const qb = f[ix(`${side}_qb_id`)];
      if (!qb) continue;
      const list = starts.get(team) ?? [];
      list.push({ wk, qb, name: f[ix(`${side}_qb_name`)] });
      starts.set(team, list);
    }
  }
  const out = {};
  for (const [team, list] of starts) {
    const last = list.sort((a, b) => a.wk - b.wk).slice(-4);
    const count = new Map();
    last.forEach((s, i) => count.set(s.qb, (count.get(s.qb) ?? 0) + 1 + i / 100));
    const qb = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out[team] = { qb, name: last.findLast((s) => s.qb === qb).name };
  }
  return out;
}

/** This week's games: team → { game, spread (team's own), open (team's own), pre }. */
async function slate() {
  const sb = await get(`${ESPN}/scoreboard`);
  const out = {};
  for (const e of sb?.events ?? []) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const home = c.competitors?.find((x) => x.homeAway === "home")?.team?.abbreviation;
    const away = c.competitors?.find((x) => x.homeAway === "away")?.team?.abbreviation;
    if (!home || !away) continue;
    const o = (c.odds ?? []).find((x) => /draft/i.test(x.provider?.name ?? "")) ?? c.odds?.[0];
    const homeSpread = typeof o?.spread === "number" ? o.spread : null;
    const openRaw = o?.pointSpread?.home?.open?.line;
    const homeOpen = openRaw != null && openRaw !== "" && Number.isFinite(Number(openRaw)) ? Number(openRaw) : null;
    const game = { id: String(e.id), name: `${away} @ ${home}`, kickoff: e.date, home, away };
    const pre = c.status?.type?.state === "pre";
    out[home] = { game, spread: homeSpread, open: homeOpen, pre };
    out[away] = { game, spread: homeSpread == null ? null : -homeSpread, open: homeOpen == null ? null : -homeOpen, pre };
  }
  return out;
}

async function injuries() {
  const json = await get(`${ESPN}/injuries`);
  if (!json) return null;
  const out = {}; // team → normName → status
  for (const t of json.injuries ?? []) {
    for (const inj of t.injuries ?? []) {
      const a = inj.athlete ?? {};
      const team = a.team?.abbreviation ?? t.abbreviation;
      if (!team || a.position?.abbreviation !== "QB") continue;
      (out[team] ??= {})[norm(a.displayName ?? a.fullName)] = String(inj.status ?? "Active");
    }
  }
  return out;
}

async function main() {
  const now = new Date().toISOString();
  let state = { updatedAt: null, starters: {}, status: {}, events: [] };
  try {
    state = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    // first run
  }
  const [starters, games, inj] = await Promise.all([regularStarters(), slate(), injuries()]);
  if (!starters || !inj) {
    console.log("could not read starters or injuries; nothing changed");
    return;
  }
  let changed = 0;
  for (const [team, s] of Object.entries(starters)) {
    const status = inj[team]?.[norm(s.name)] ?? "Active";
    const prev = state.status[team];
    const sameQb = state.starters[team]?.qb === s.qb;
    if (!prev || !sameQb) {
      state.status[team] = { status, since: now };
      state.starters[team] = s;
      if (!prev) continue;
      changed += 1;
      continue; // a new regular starter isn't news by itself
    }
    if (level(status) !== level(prev.status)) {
      const g = games[team];
      state.events.push({
        id: `${team}-${s.qb}-${now}`,
        team,
        qb: s.qb,
        name: s.name,
        from: prev.status,
        to: status,
        at: now,
        game: g?.pre ? g.game : null,
        open: g?.pre ? g.open : null,
        atNews: g?.pre ? g.spread : null,
        now: g?.pre ? g.spread : null,
        track: g?.pre && g.spread != null ? [[now, g.spread]] : [],
      });
      console.log(`NEWS ${team} ${s.name}: ${prev.status} → ${status}${g?.pre ? ` (${g.game.name}, spread ${g.spread})` : ""}`);
      changed += 1;
    }
    if (status !== prev.status) state.status[team] = { status, since: now };
  }
  // keep following the line for events whose game hasn't started
  for (const ev of state.events) {
    const g = games[ev.team];
    // news that broke on a bye week or right after a game: attach the team's next game once it's on the
    // scoreboard (within 8 days); "atNews" is then the first line seen after the news
    if (!ev.game && g?.pre && g.spread != null && Date.parse(now) - Date.parse(ev.at) < 8 * 86_400_000) {
      Object.assign(ev, { game: g.game, open: g.open, atNews: g.spread, now: g.spread, track: [[now, g.spread]], late: true });
      changed += 1;
      continue;
    }
    if (!ev.game) continue;
    if (!g || g.game.id !== ev.game.id || !g.pre || g.spread == null) continue;
    if (g.spread !== ev.now) {
      ev.now = g.spread;
      ev.track.push([now, g.spread]);
      changed += 1;
    }
    if (ev.open == null && g.open != null) ev.open = g.open;
  }
  if (!changed && state.updatedAt) {
    console.log("no changes");
    return;
  }
  state.updatedAt = now;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(state));
  console.log(`${changed} change(s); ${state.events.length} events this season`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
