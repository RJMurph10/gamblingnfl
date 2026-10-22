/**
 * Past NFL seasons (final scores + closing lines), pulled live from nflverse's public games file
 * (github.com/nflverse/nfldata). Finished seasons never change, so it's fetched once and kept
 * for 12 hours.
 */

import { CURRENT_SEASON } from "./espn.server";
import type { HistoryGame } from "./model-history";

const GAMES_CSV = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
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

/** Finished regular-season games from `first` through `last`. Exported for tests. */
export function parseHistoryCsv(csv: string, first: number, last: number): HistoryGame[] {
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
  };
  const out: HistoryGame[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const season = Number(f[idx.season]);
    if (f[idx.type] !== "REG" || season < first || season > last) continue;
    const awayScore = num(f[idx.awayScore]);
    const homeScore = num(f[idx.homeScore]);
    if (awayScore === null || homeScore === null) continue;
    out.push({
      season,
      week: Number(f[idx.week]),
      espnId: Number(f[idx.espn]),
      date: f[idx.date],
      away: ABBR_FIX[f[idx.away]] ?? f[idx.away],
      home: ABBR_FIX[f[idx.home]] ?? f[idx.home],
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
    });
  }
  return out;
}

let cache: { at: number; games: HistoryGame[] } | null = null;
const TTL = 12 * 60 * 60 * 1000;

/** Every finished past season (2022 through last season). Empty if GitHub can't be reached. */
export async function fetchNflHistory(): Promise<HistoryGame[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.games;
  try {
    const res = await fetch(GAMES_CSV);
    if (!res.ok) throw new Error(`nflverse ${res.status}`);
    const games = parseHistoryCsv(await res.text(), FIRST_HISTORY_SEASON, CURRENT_SEASON - 1);
    cache = { at: Date.now(), games };
    return games;
  } catch (err) {
    console.error("nfl history unavailable", err);
    return cache?.games ?? [];
  }
}
