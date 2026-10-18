/**
 * Server-only: yards-after-catch numbers from nflverse's public weekly player stats
 * (passing_yards_after_catch for quarterbacks, receiving_yards_after_catch for
 * running backs, receivers and tight ends). ESPN does not publish these per game.
 *
 * nflverse updates its files after games finish (usually the next morning), so a game
 * that ended minutes ago may not have numbers yet; callers should treat a miss as "no data".
 */

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const TTL_MS = 3 * 60 * 60 * 1000;

export interface NflverseYacRow {
  name: string;
  team: string;
  week: number;
  seasonType: string;
  /** Passing yards after catch (credited to the passer). */
  pyac: number;
  /** Receiving yards after catch (credited to the receiver). */
  yac: number;
}

interface Loaded {
  at: number;
  rows: NflverseYacRow[];
  byNameWeek: Map<string, NflverseYacRow>;
}

const cache = new Map<number, Loaded>();

/** "Patrick Mahomes II" -> "patrickmahomes" so ESPN and nflverse names line up. */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/** Quote-aware split of one CSV line. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseRows(csv: string): NflverseYacRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const col = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iName = col("player_display_name", "player_name");
  const iTeam = col("team", "recent_team");
  const iWeek = col("week");
  const iType = col("season_type");
  const iPyac = col("passing_yards_after_catch");
  const iYac = col("receiving_yards_after_catch");
  if (iName < 0 || iWeek < 0) return [];
  const rows: NflverseYacRow[] = [];
  for (let l = 1; l < lines.length; l++) {
    if (!lines[l]) continue;
    const cells = splitCsvLine(lines[l]);
    const week = Number(cells[iWeek]);
    if (!Number.isFinite(week)) continue;
    rows.push({
      name: cells[iName] ?? "",
      team: iTeam >= 0 ? cells[iTeam] ?? "" : "",
      week,
      seasonType: iType >= 0 ? cells[iType] ?? "REG" : "REG",
      pyac: iPyac >= 0 ? Number(cells[iPyac]) || 0 : 0,
      yac: iYac >= 0 ? Number(cells[iYac]) || 0 : 0,
    });
  }
  return rows;
}

async function load(season: number): Promise<Loaded | null> {
  const hit = cache.get(season);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  // Current file name first, then the older one.
  const urls = [
    `${BASE}/stats_player/stats_player_week_${season}.csv`,
    `${BASE}/player_stats/player_stats_${season}.csv`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "GamblingNFL/1.0" } });
      if (!res.ok) continue;
      const rows = parseRows(await res.text());
      if (rows.length === 0) continue;
      const byNameWeek = new Map<string, NflverseYacRow>();
      for (const row of rows) byNameWeek.set(`${normalizePlayerName(row.name)}|${row.week}`, row);
      const loaded = { at: Date.now(), rows, byNameWeek };
      cache.set(season, loaded);
      return loaded;
    } catch {
      // try the next URL
    }
  }
  return hit ?? null;
}

/** One player's YAC numbers for one game week, or undefined when nflverse has nothing yet. */
export async function nflverseGameYac(
  name: string,
  season: number,
  week: number,
): Promise<{ pyac: number; yac: number } | undefined> {
  const loaded = await load(season);
  const row = loaded?.byNameWeek.get(`${normalizePlayerName(name)}|${week}`);
  return row ? { pyac: row.pyac, yac: row.yac } : undefined;
}

/** A player's regular-season totals so far, or undefined when nflverse has nothing yet. */
export async function nflverseSeasonYac(
  name: string,
  season: number,
): Promise<{ pyac: number; yac: number; games: number } | undefined> {
  const loaded = await load(season);
  if (!loaded) return undefined;
  const key = normalizePlayerName(name);
  const mine = loaded.rows.filter((row) => row.seasonType === "REG" && normalizePlayerName(row.name) === key);
  if (mine.length === 0) return undefined;
  return {
    pyac: mine.reduce((sum, row) => sum + row.pyac, 0),
    yac: mine.reduce((sum, row) => sum + row.yac, 0),
    games: mine.length,
  };
}
