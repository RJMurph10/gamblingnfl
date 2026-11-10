#!/usr/bin/env node
/**
 * QB and injury news watch (NFL). Runs every 10 minutes during the season. QBs:
 *   1. finds each team's regular starting QB (most starts in its last 4 games, from nflverse), plus its
 *      season starter if different (most starts this season: a star on IR whose return is news),
 *   2. reads ESPN's live injury report for that QB (Active / Questionable / Doubtful / Out / IR),
 *   3. logs every status change with the time and DraftKings' spread at that moment,
 *   4. keeps tracking the spread until kickoff, so you can see if (and when) the line caught up.
 * Every other position: players worth 0.4+ points on the spread (player-values-<season>.json, built
 * daily) are logged when they go to Doubtful/Out/IR or come back, with their value as "pts".
 * The site shows it as the "Injury news" panel (it adds the QBs' expected line move from its QB ratings).
 *
 *   node scripts/nfl/qb-watch.mjs --season 2026 --out site-repo
 *   → <out>/nfl/qb-watch-2026.json
 *   { updatedAt, starters: {"team|qb": {team, qb, name, role}}, status: {"team|qb": {status, since}},
 *     events: [{ id, team, qb | player, name, role | pos+pts, from, to, at, game: {id, name, kickoff, home, away},
 *                open, atNews, now, track: [[at, spread]],
 *                props: { atNews: {"player|market": line}, now: {...}, track: [[at, "player|market", line]] } }] }
 * props: the team's other DraftKings prop lines (from <out>/nfl/upcoming.json, refreshed hourly) at the
 * news and as they move after it, to measure how long books take to adjust teammates' props.
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

/**
 * QBs to watch per team: the regular starter (most starts in its last 4 games, latest breaks ties) and,
 * if different, the season starter (most starts this season, e.g. a star on IR whose return is news).
 */
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
  const top = (list) => {
    const count = new Map();
    list.forEach((s, i) => count.set(s.qb, (count.get(s.qb) ?? 0) + 1 + i / 1000));
    const qb = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { qb, name: list.findLast((s) => s.qb === qb).name };
  };
  for (const [team, list] of starts) {
    list.sort((a, b) => a.wk - b.wk);
    const regular = { ...top(list.slice(-4)), role: "regular" };
    const season = top(list);
    out[team] = season.qb === regular.qb ? [regular] : [regular, { ...season, role: "season starter" }];
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
  const out = {}; // team → normName → status (QBs)
  const byId = {}; // ESPN athlete id → status (everyone)
  for (const t of json.injuries ?? []) {
    for (const inj of t.injuries ?? []) {
      const a = inj.athlete ?? {};
      const team = a.team?.abbreviation ?? t.abbreviation;
      const status = String(inj.status ?? "Active");
      // the athlete id: a.id when present, else from the uid ("s:20~l:28~a:4035369") or the player link
      const aid =
        a.id ??
        String(a.uid ?? "").match(/a:(\d+)/)?.[1] ??
        (a.links ?? []).map((l) => String(l.href ?? "").match(/\/id\/(\d+)/)?.[1]).find(Boolean);
      if (aid) byId[String(aid)] = status;
      if (!team || a.position?.abbreviation !== "QB") continue;
      (out[team] ??= {})[norm(a.displayName ?? a.fullName)] = status;
    }
  }
  return { out, byId };
}

/** Players worth MIN_POINTS+ on the spread (scripts/nfl/player-values.mjs, built daily). */
const MIN_POINTS = 0.4;
async function playerValues() {
  try {
    const f = JSON.parse(await readFile(join(OUT, "nfl", `player-values-${SEASON}.json`), "utf8"));
    return Object.entries(f.players).filter(([, p]) => p[2] !== "QB" && p[5] >= MIN_POINTS);
  } catch {
    return [];
  }
}

/** The team's DraftKings prop lines on the board for a game, minus the player in the news: {"name|market": line}. */
function teamProps(board, gameId, team, exclude) {
  const g = board?.find((x) => String(x.id) === String(gameId));
  if (!g) return null;
  const out = {};
  for (const [name, tm, market, line] of g.props ?? []) {
    if (tm !== team || norm(name) === norm(exclude)) continue;
    out[`${name}|${market}`] = line;
  }
  return Object.keys(out).length ? out : null;
}

async function main() {
  const now = new Date().toISOString();
  let board = null;
  try {
    board = JSON.parse(await readFile(join(OUT, "nfl", "upcoming.json"), "utf8"));
  } catch {
    // no props board in this checkout
  }
  let state = { updatedAt: null, starters: {}, status: {}, events: [] };
  try {
    state = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    // first run
  }
  const [starters, games, injAll, values] = await Promise.all([regularStarters(), slate(), injuries(), playerValues()]);
  const inj = injAll?.out;
  if (!starters || !inj) {
    console.log("could not read starters or injuries; nothing changed");
    return;
  }
  const propsAt = (g, team, name) => {
    const lines = g?.pre ? teamProps(board, g.game.id, team, name) : null;
    return lines ? { props: { atNews: lines, now: { ...lines }, track: [] } } : {};
  };
  let changed = 0;
  for (const [team, list] of Object.entries(starters)) {
    for (const s of list) {
      const key = `${team}|${s.qb}`;
      const status = inj[team]?.[norm(s.name)] ?? "Active";
      const prev = state.status[key];
      state.starters[key] = { team, ...s };
      if (!prev) {
        state.status[key] = { status, since: now };
        changed += 1;
        continue; // first time watching this QB: not news by itself
      }
      if (level(status) !== level(prev.status)) {
        const g = games[team];
        state.events.push({
          id: `${key}|${now}`,
          team,
          qb: s.qb,
          name: s.name,
          role: s.role,
          from: prev.status,
          to: status,
          at: now,
          game: g?.pre ? g.game : null,
          open: g?.pre ? g.open : null,
          atNews: g?.pre ? g.spread : null,
          now: g?.pre ? g.spread : null,
          track: g?.pre && g.spread != null ? [[now, g.spread]] : [],
          ...propsAt(g, team, s.name),
        });
        console.log(`NEWS ${team} ${s.name} (${s.role}): ${prev.status} → ${status}${g?.pre ? ` (${g.game.name}, spread ${g.spread})` : ""}`);
        changed += 1;
      }
      if (status !== prev.status) state.status[key] = { status, since: now };
    }
  }
  // Every other position: valued players, logged when they go to Doubtful/Out/IR or come back from it
  // (Questionable alone isn't logged). Event "pts" = what the market typically moves the team's spread.
  const out = (st) => level(st) >= 2;
  for (const [espnId, [name, team, pos, snap, capPct, pts]] of values) {
    const key = `p|${espnId}`;
    const status = injAll.byId[espnId] ?? "Active";
    const prev = state.status[key];
    if (!prev) {
      state.status[key] = { status, since: now };
      changed += 1;
      continue;
    }
    if (out(status) !== out(prev.status)) {
      const g = games[team];
      state.events.push({
        id: `${key}|${now}`,
        team,
        player: espnId,
        name,
        pos,
        pts,
        from: prev.status,
        to: status,
        at: now,
        game: g?.pre ? g.game : null,
        open: g?.pre ? g.open : null,
        atNews: g?.pre ? g.spread : null,
        now: g?.pre ? g.spread : null,
        track: g?.pre && g.spread != null ? [[now, g.spread]] : [],
        ...propsAt(g, team, name),
      });
      console.log(`NEWS ${team} ${name} (${pos}, ${pts} pts): ${prev.status} → ${status}`);
      changed += 1;
    }
    if (status !== prev.status) state.status[key] = { status, since: now };
  }
  // QBs and players no longer watched drop out of the status list
  const matched = values.filter(([id]) => injAll.byId[id] !== undefined).length;
  console.log(`players on ESPN's injury report matched to valued players: ${matched}; ids read: ${Object.keys(injAll.byId).length}`);
  const watched = new Set([
    ...Object.entries(starters).flatMap(([t, l]) => l.map((s) => `${t}|${s.qb}`)),
    ...values.map(([id]) => `p|${id}`),
  ]);
  for (const k of Object.keys(state.status)) if (!watched.has(k)) delete state.status[k];
  for (const k of Object.keys(state.starters)) if (!watched.has(k)) delete state.starters[k];
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
  // follow teammates' prop lines until kickoff (attach them if the board had none at the news)
  for (const ev of state.events) {
    if (!ev.game || Date.parse(ev.game.kickoff) <= Date.parse(now)) continue;
    const lines = teamProps(board, ev.game.id, ev.team, ev.name);
    if (!lines) continue;
    if (!ev.props) {
      ev.props = { atNews: lines, now: { ...lines }, track: [], late: true };
      changed += 1;
      continue;
    }
    for (const [k, line] of Object.entries(lines)) {
      if (ev.props.now[k] === line) continue;
      if (!(k in ev.props.atNews)) ev.props.atNews[k] = line; // first posted after the news
      else ev.props.track.push([now, k, line]);
      ev.props.now[k] = line;
      changed += 1;
    }
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
