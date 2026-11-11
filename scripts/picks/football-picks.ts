/**
 * NFL and college football picks, recorded the first time they appear: every ★ best bet and every
 * watch-list angle on an upcoming game, with the line at that moment. Each run after that updates the
 * latest line until kickoff; grade-picks.mjs then grades the pick at the line it was posted at and
 * compares that line with the close (ESPN's closing line once the game is final).
 *
 * Runs with the site's own code (the same model, forecasts and angles the pages show), so what's
 * recorded is what the site said at the time.
 *
 *   npx tsx scripts/picks/football-picks.ts <out-dir> [nfl|cfb ...]
 *   Files: <out-dir>/<league>/<ET day>.json (same format as the basketball picks).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Game } from "../../src/data/shared/games";
import { registerTeams, teamById } from "../../src/data/shared/teams";
import { cfbWatchHits, outdoorStadium, runCfbModel } from "../../src/lib/cfb/cfb-model";
import {
  fetchCfbPriorSeasonResults,
  fetchCfbSchedule,
} from "../../src/lib/cfb/cfb-espn.server";
import { readHistory, runModelWithHistory } from "../../src/lib/nfl/model-history";
import { fetchNflHistory } from "../../src/lib/nfl/nfl-history.server";
import { fetchPriorSeasonResults, fetchSchedule } from "../../src/lib/nfl/nfl-schedule.server";
import { buildWatchList, type GameConditions } from "../../src/lib/nfl/watch-angles";
import {
  fetchAngleForecasts,
  type ForecastRequest,
} from "../../src/lib/shared/angle-weather.server";
import type { GameModelRow, KickoffWeather } from "../../src/lib/shared/game-model";
import { homeLine } from "../../src/lib/shared/season-pulse";

const [OUT = "picks", ...ARGS] = process.argv.slice(2);
const LEAGUES = (ARGS.length ? ARGS : ["nfl", "cfb"]) as ("nfl" | "cfb")[];
/** Record picks for games kicking off within this many days (forecasts reach about a week). */
const DAYS = 7;
const DAY = 86_400_000;

export interface FootballPick {
  id: string;
  game: string;
  tip: string;
  market: "total" | "spread";
  /** "Under 44.5", "KC -3.5" (the picked team's number). */
  pick: string;
  /**
   * The number you could bet when the pick first showed (the market then): the total, or the home
   * team's spread. Picks are graded and compared with the close at this number.
   */
  line: number;
  /** The rule's own number when it differs (rules graded at the opener: open-total, total-gap, weather). */
  rule?: number;
  open: number | null;
  model: number | null;
  edge: number | null;
  /** ★ best bet (true) or a watch-list angle (false). */
  best: boolean;
  /** Which rule or angle: "wind", "rivalry", "open-total", "gusty-rain", "weather", ... */
  tag: string;
  /** Kickoff forecast behind a weather pick, as shown on the site. */
  note?: string;
  firstSeen: string;
  /** Last run the site still showed this pick (picks can drop off as lines and forecasts move). */
  lastSeen: string;
  latest: number | null;
  latestAt: string;
}

const etDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
const round1 = (n: number) => Math.round(n * 10) / 10;
const lineText = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));
const eventId = (g: Game) => g.id.replace(/^\D+/, "");
const abbr = (id: string) => teamById(id)?.abbr ?? id;
const matchup = (g: Game) => `${abbr(g.awayTeamId)} @ ${abbr(g.homeTeamId)}`;

/** The pick text and the home-perspective line for one side of a market. */
export function describe(
  g: Game,
  market: "total" | "spread",
  side: "home" | "away" | "over" | "under",
  homeNumber: number,
): { pick: string; line: number } {
  if (market === "total")
    return { pick: `${side === "over" ? "Over" : "Under"} ${homeNumber}`, line: homeNumber };
  const team = side === "home" ? g.homeTeamId : g.awayTeamId;
  const n = side === "home" ? homeNumber : -homeNumber;
  return { pick: `${abbr(team)} ${lineText(n)}`, line: homeNumber };
}

/** The pick at the number on the board now; keeps the rule's number when it differs. */
export function atMarket(
  g: Game,
  market: "total" | "spread",
  side: "home" | "away" | "over" | "under",
  ruleHome: number,
) {
  const now = marketNow(g, market) ?? ruleHome;
  return { ...describe(g, market, side, now), ...(now !== ruleHome ? { rule: ruleHome } : {}) };
}

/** Current market number on a game: the total, or the home spread. */
const marketNow = (g: Game, market: "total" | "spread") =>
  market === "total" ? (g.total > 0 ? g.total : null) : homeLine(g);

const windText = (c: KickoffWeather | GameConditions | null | undefined) => {
  if (!c || !c.outdoor || c.wind === null) return undefined;
  const bits = [`${Math.round(c.wind)} mph`];
  if (c.gustMph) bits.push(`gusts ${c.gustMph}`);
  if ((c.snowIn ?? 0) >= 0.1) bits.push("snow");
  else if ((c.rainHours ?? 0) > 0 || (c.precipIn ?? 0) >= 0.05) bits.push("rain");
  return bits.join(" · ");
};

/** ★ picks on upcoming games from a model run. */
function starPicks(rows: GameModelRow[], upcoming: (g: Game) => boolean, stamp: string) {
  const out: FootballPick[] = [];
  for (const r of rows) {
    const g = r.game;
    if (!upcoming(g)) continue;
    for (const p of r.picks) {
      if (!p.best || (p.market !== "total" && p.market !== "spread") || p.line === undefined)
        continue;
      const market = p.market;
      // ModelPick lines: home spread for "home", away spread for "away", the total for totals
      const home = market === "spread" && p.side === "away" ? -p.line : p.line;
      const at = atMarket(g, market, p.side, home);
      const dir = market === "total" ? (p.side === "over" ? 1 : -1) : p.side === "home" ? -1 : 1;
      out.push({
        id: `${eventId(g)}-${market}-${p.reason ?? "star"}`,
        game: matchup(g),
        tip: g.kickoffIso!,
        market,
        ...at,
        open:
          market === "total" ? (g.odds?.totalOpen ?? null) : (g.odds?.homeSpreadOpen ?? null),
        model: p.edge ? round1(home + dir * p.edge) : null,
        edge: p.edge ? round1(p.edge) : null,
        best: true,
        tag: p.reason ?? "star",
        ...(p.wind !== undefined ? { note: `${Math.round(p.wind)} mph${p.snow ? " · snow" : p.rain ? " · rain" : ""}` } : {}),
        firstSeen: stamp,
        lastSeen: stamp,
        latest: marketNow(g, market),
        latestAt: stamp,
      });
    }
  }
  return out;
}

async function forecastsFor(reqs: ForecastRequest[]) {
  const out: Record<string, GameConditions | null> = {};
  for (let i = 0; i < reqs.length; i += 16)
    Object.assign(out, await fetchAngleForecasts(reqs.slice(i, i + 16)));
  return out;
}

async function nflPicks(stamp: string): Promise<{ picks: FootballPick[]; games: Game[] }> {
  const now = Date.now();
  const [games, prior, raw] = await Promise.all([
    fetchSchedule(),
    fetchPriorSeasonResults(),
    fetchNflHistory(),
  ]);
  const upcoming = (g: Game) =>
    g.status === "scheduled" &&
    !!g.kickoffIso &&
    Date.parse(g.kickoffIso) > now &&
    Date.parse(g.kickoffIso) < now + DAYS * DAY;
  const { games: all, currentSeason, upcoming: starters, qbRows } = readHistory(raw);
  const forecasts = await forecastsFor(
    games.filter(upcoming).map((g) => ({
      id: g.id,
      homeTeamId: g.homeTeamId,
      venue: g.venue || undefined,
      kickoffIso: g.kickoffIso!,
    })),
  );
  const history = all.filter((h) => h.season < currentSeason);
  const rows = runModelWithHistory(
    games,
    prior,
    history,
    {
      season: currentSeason,
      games: all.filter((h) => h.season === currentSeason),
      upcoming: starters,
      forecasts,
    },
    { qbRows },
  );
  const picks = starPicks(rows, upcoming, stamp);
  // watch-list angles (this season's upcoming games only)
  const list = buildWatchList(all, currentSeason, games, forecasts, [
    { season: currentSeason, rows },
  ]);
  for (const h of list.hits) {
    const g = h.game;
    if (h.season !== currentSeason || !upcoming(g)) continue;
    const m = h.label.match(/^(Over|Under)\s+([\d.]+)$/i);
    let market: "total" | "spread";
    let side: "home" | "away" | "over" | "under";
    let home: number | null;
    if (m) {
      market = "total";
      side = m[1].toLowerCase() as "over" | "under";
      home = Number(m[2]);
    } else {
      const s = h.label.match(/^(\S+)\s+(PK|[+-]?[\d.]+)$/i);
      if (!s) continue;
      market = "spread";
      side = s[1].toUpperCase() === abbr(g.homeTeamId).toUpperCase() ? "home" : "away";
      const n = /pk/i.test(s[2]) ? 0 : Number(s[2]);
      home = side === "home" ? n : -n;
    }
    picks.push({
      id: `${eventId(g)}-${market}-${h.angle}`,
      game: matchup(g),
      tip: g.kickoffIso!,
      market,
      ...atMarket(g, market, side, home),
      open: market === "total" ? (g.odds?.totalOpen ?? null) : (g.odds?.homeSpreadOpen ?? null),
      model: null,
      edge: null,
      best: false,
      tag: h.angle,
      ...(h.conditions ? { note: windText(h.conditions) } : {}),
      firstSeen: stamp,
      lastSeen: stamp,
      latest: marketNow(g, market),
      latestAt: stamp,
    });
  }
  return { picks, games };
}

async function cfbPicks(stamp: string): Promise<{ picks: FootballPick[]; games: Game[] }> {
  const now = Date.now();
  const [games, prior] = await Promise.all([fetchCfbSchedule(), fetchCfbPriorSeasonResults()]);
  for (const g of games) registerTeams(g.teamRefs);
  const upcoming = (g: Game) =>
    g.status === "scheduled" &&
    !g.fcs &&
    !!g.kickoffIso &&
    Date.parse(g.kickoffIso) > now &&
    Date.parse(g.kickoffIso) < now + DAYS * DAY;
  const picks = starPicks(runCfbModel(games, prior), upcoming, stamp);
  const reqs: ForecastRequest[] = games
    .filter((g) => upcoming(g) && g.total && !g.neutralSite && outdoorStadium(g.homeTeamId))
    .map((g) => ({
      id: g.id,
      homeTeamId: g.homeTeamId,
      kickoffIso: g.kickoffIso!,
      ...outdoorStadium(g.homeTeamId)!,
    }));
  const weather = await forecastsFor(reqs);
  for (const h of cfbWatchHits(games, weather)) {
    const g = h.game;
    if (!upcoming(g)) continue;
    picks.push({
      id: `${eventId(g)}-${h.market}-${h.angle}`,
      game: matchup(g),
      tip: g.kickoffIso!,
      market: h.market,
      ...atMarket(g, h.market, h.side, h.line),
      open:
        h.market === "total" ? (g.odds?.totalOpen ?? null) : (g.odds?.homeSpreadOpen ?? null),
      model: null,
      edge: null,
      best: false,
      tag: h.angle,
      ...(h.weather ? { note: h.weather } : {}),
      firstSeen: stamp,
      lastSeen: stamp,
      latest: marketNow(g, h.market),
      latestAt: stamp,
    });
  }
  return { picks, games };
}

/** Merge this run into the saved day files: keep first-seen picks, refresh the latest line. */
export function mergeDay(
  saved: FootballPick[],
  found: FootballPick[],
  live: Map<string, Game>,
  stamp: string,
) {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const fresh: FootballPick[] = [];
  for (const p of found) {
    const old = byId.get(p.id);
    if (old) old.lastSeen = stamp;
    else {
      byId.set(p.id, p);
      fresh.push(p);
    }
  }
  for (const p of byId.values()) {
    const g = live.get(p.id.split("-")[0]);
    if (!g || g.status !== "scheduled") continue;
    const n = marketNow(g, p.market);
    if (n !== null) {
      p.latest = n;
      p.latestAt = stamp;
    }
  }
  const picks = [...byId.values()].sort(
    (a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id),
  );
  return { picks, fresh };
}

async function main() {
  const stamp = new Date().toISOString();
  for (const league of LEAGUES) {
    let run: { picks: FootballPick[]; games: Game[] };
    try {
      run = league === "nfl" ? await nflPicks(stamp) : await cfbPicks(stamp);
    } catch (e) {
      console.error(`${league}: failed`, e);
      continue;
    }
    const live = new Map(run.games.map((g) => [eventId(g), g]));
    const byDay = new Map<string, FootballPick[]>();
    for (const p of run.picks) byDay.set(etDay(p.tip), [...(byDay.get(etDay(p.tip)) ?? []), p]);
    // also refresh lines in day files that have no new picks this run (this week's games)
    const days = new Set(byDay.keys());
    for (let d = 0; d <= DAYS; d++) days.add(etDay(new Date(Date.now() + d * DAY).toISOString()));
    await mkdir(join(OUT, league), { recursive: true });
    let total = 0;
    for (const day of [...days].sort()) {
      const file = join(OUT, league, `${day}.json`);
      let saved: FootballPick[] = [];
      try {
        saved = JSON.parse(await readFile(file, "utf8")).picks ?? [];
      } catch {
        // no file yet
      }
      const { picks, fresh } = mergeDay(saved, byDay.get(day) ?? [], live, stamp);
      if (!picks.length) continue;
      total += fresh.length;
      await writeFile(file, JSON.stringify({ day, updated: stamp, picks }, null, 1));
      console.log(`${league} ${day}: ${picks.length} picks (${fresh.length} new)`);
    }
    console.log(`${league}: ${run.picks.length} on the board now, ${total} new`);
  }
}

if (process.argv[1]?.endsWith("football-picks.ts"))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
