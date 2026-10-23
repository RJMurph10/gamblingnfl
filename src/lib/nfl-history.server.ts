/**
 * NFL results since 2022 (final scores, closing lines, kickoff weather, starting quarterbacks and
 * each team's passing efficiency), pulled live from nflverse's public files
 * (github.com/nflverse/nfldata and nflverse-data), at most once an hour.
 */

import { CURRENT_SEASON } from "./espn.server";
import type { HistoryGame, UpcomingStarters } from "./model-history";

const GAMES_CSV = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const TEAM_WEEK_CSV = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
/** First season pulled. The first one only serves as the prior for the next. */
export const FIRST_HISTORY_SEASON = 2022;

/** nflverse uses a few abbreviations that differ from the site's. */
const ABBR_FIX: Record<string, string> = {
  LA: "LAR",
  WAS: "WSH",
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
};

/** Splits one CSV line, honoring quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

const num = (s: string | undefined) => {
  if (s === undefined || s === "" || s === "NA") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "season|week|TEAM" → that team's passing EPA and dropbacks in that game. */
export type PassingByTeamWeek = Map<string, { epa: number; dropbacks: number }>;

const fix = (abbr: string) => ABBR_FIX[abbr] ?? abbr;

/** Reads one nflverse team-week stats file into passing EPA + dropbacks per team-game. */
export function parseTeamWeekCsv(csv: string, into: PassingByTeamWeek = new Map()) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return into;
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const i = {
    season: col("season"),
    week: col("week"),
    team: col("team"),
    type: col("season_type"),
    attempts: col("attempts"),
    sacks: col("sacks_suffered"),
    epa: col("passing_epa"),
  };
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    if (f[i.type] !== "REG") continue;
    const dropbacks = (num(f[i.attempts]) ?? 0) + (num(f[i.sacks]) ?? 0);
    const epa = num(f[i.epa]);
    if (!dropbacks || epa === null) continue;
    into.set(`${f[i.season]}|${f[i.week]}|${fix(f[i.team])}`, { epa, dropbacks });
  }
  return into;
}

/** Finished regular-season games from `first` through `last`. Exported for tests. */
export function parseHistoryCsv(
  csv: string,
  first: number,
  last: number,
  passing: PassingByTeamWeek = new Map(),
): HistoryGame[] {
  return parseGamesCsv(csv, first, last, passing).games;
}

/** Finished games, plus this season's upcoming games with their projected starting QBs. */
export function parseGamesCsv(
  csv: string,
  first: number,
  last: number,
  passing: PassingByTeamWeek = new Map(),
): { games: HistoryGame[]; upcoming: UpcomingStarters[] } {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const idx = {
    season: col("season"),
    type: col("game_type"),
    week: col("week"),
    date: col("gameday"),
    espn: col("espn"),
    away: col("away_team"),
    home: col("home_team"),
    awayScore: col("away_score"),
    homeScore: col("home_score"),
    spread: col("spread_line"),
    total: col("total_line"),
    awayMl: col("away_moneyline"),
    homeMl: col("home_moneyline"),
    awaySpreadOdds: col("away_spread_odds"),
    homeSpreadOdds: col("home_spread_odds"),
    over: col("over_odds"),
    under: col("under_odds"),
    roof: col("roof"),
    temp: col("temp"),
    wind: col("wind"),
    location: col("location"),
    gametime: col("gametime"),
    homeQb: col("home_qb_id"),
    awayQb: col("away_qb_id"),
    homeQbName: col("home_qb_name"),
    awayQbName: col("away_qb_name"),
  };
  const out: HistoryGame[] = [];
  const upcoming: UpcomingStarters[] = [];
  const str = (v: string | undefined) => (v && v !== "NA" ? v : null);
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const season = Number(f[idx.season]);
    if (f[idx.type] !== "REG" || season < first || season > last) continue;
    const awayScore = num(f[idx.awayScore]);
    const homeScore = num(f[idx.homeScore]);
    const week = Number(f[idx.week]);
    const away = fix(f[idx.away]);
    const home = fix(f[idx.home]);
    const qbs = {
      homeQb: str(f[idx.homeQb]),
      awayQb: str(f[idx.awayQb]),
      homeQbName: str(f[idx.homeQbName]),
      awayQbName: str(f[idx.awayQbName]),
    };
    if (awayScore === null || homeScore === null) {
      if (season === last && (qbs.homeQb || qbs.awayQb))
        upcoming.push({ espnId: Number(f[idx.espn]), week, ...qbs });
      continue;
    }
    const pass = (team: string) => passing.get(`${season}|${week}|${team}`) ?? null;
    out.push({
      season,
      week,
      espnId: Number(f[idx.espn]),
      date: f[idx.date],
      away,
      home,
      awayScore,
      homeScore,
      homeFavoredBy: num(f[idx.spread]),
      total: num(f[idx.total]),
      awayMoneyline: num(f[idx.awayMl]),
      homeMoneyline: num(f[idx.homeMl]),
      awaySpreadOdds: num(f[idx.awaySpreadOdds]),
      homeSpreadOdds: num(f[idx.homeSpreadOdds]),
      overOdds: num(f[idx.over]),
      underOdds: num(f[idx.under]),
      roof: f[idx.roof] ?? "",
      temp: num(f[idx.temp]),
      wind: num(f[idx.wind]),
      neutral: f[idx.location] === "Neutral",
      kickoffEt: str(f[idx.gametime]),
      ...qbs,
      homePass: pass(home),
      awayPass: pass(away),
    });
  }
  return { games: out, upcoming };
}

export interface NflHistory {
  /** The season being played now; `games` from it are this season's finished games. */
  currentSeason: number;
  /** Finished regular-season games from 2022 through this season so far. */
  games: HistoryGame[];
  /** This season's upcoming games with nflverse's projected starting QBs (about 2 weeks out). */
  upcoming: UpcomingStarters[];
}

let cache: { at: number; value: NflHistory } | null = null;
/** The file gains this season's scores and weather each week, so it's re-read hourly. */
const TTL = 60 * 60 * 1000;

/** Past seasons plus this season's finished games. Empty if GitHub can't be reached. */
export async function fetchNflHistory(): Promise<NflHistory> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  try {
    const seasons = Array.from(
      { length: CURRENT_SEASON - FIRST_HISTORY_SEASON + 1 },
      (_, i) => FIRST_HISTORY_SEASON + i,
    );
    const [res, ...statFiles] = await Promise.all([
      fetch(GAMES_CSV),
      // Passing efficiency per team-game rates the quarterbacks. Optional: without it the model
      // simply runs without QB ratings.
      ...seasons.map((y) =>
        fetch(TEAM_WEEK_CSV(y))
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
      ),
    ]);
    if (!res.ok) throw new Error(`nflverse ${res.status}`);
    const passing: PassingByTeamWeek = new Map();
    for (const text of statFiles) parseTeamWeekCsv(text, passing);
    const { games, upcoming } = parseGamesCsv(
      await res.text(),
      FIRST_HISTORY_SEASON,
      CURRENT_SEASON,
      passing,
    );
    const value = { currentSeason: CURRENT_SEASON, games, upcoming };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("nfl history unavailable", err);
    return cache?.value ?? { currentSeason: CURRENT_SEASON, games: [], upcoming: [] };
  }
}
