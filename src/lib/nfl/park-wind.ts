/**
 * Stadiums where wind unders have beaten the league's (claude/nfl-stadium-wind.md; closing totals,
 * 2000-2026 with Open-Meteo hourly weather filling gaps). League, every other outdoor park: windy
 * (10+ mph) unders 52-58%. Shown as a note on those parks' ★ wind unders; the ★ itself is the same
 * league-wide rule. Jacksonville and Tampa were checked and dropped: no edge beyond the league.
 */
import type { Game } from "@/data/shared/games";
import { teamById } from "@/data/shared/teams";
import { getStadiumForGame } from "./stadiums";

interface ParkWind {
  park: string;
  /** The wind band the record is for (mph, inclusive min). */
  min: number;
  record: string;
}

export const PARK_WIND: Record<string, ParkWind> = {
  PHI: { park: "Linc", min: 10, record: "unders 31-8 since 2016 (50-28 since 2003)" },
  BAL: { park: "M&T Bank", min: 15, record: "unders 15-6 at 15+ mph" },
};

/** Wind + rain, league-wide (2000-26, hourly stadium weather; 63% in every era incl. 2021-26). */
export const WIND_RAIN_NOTE = "wind + rain: unders 196-114 (63%)";
/** Wind + snow (NFL gusts 25+ 18-11; college 13-3, ~12 pts under). */
export const WIND_SNOW_NOTE = "wind + snow: unders 13-3 in college, 18-11 NFL in 25+ gusts";

/** The park's wind record for an NFL home game at its own stadium, when the wind is in its band. */
export function parkWindNote(game: Game, wind: number | null | undefined): string | null {
  if (wind === null || wind === undefined || game.homeTeamId.startsWith("cfb-")) return null;
  const abbr = teamById(game.homeTeamId)?.abbr;
  const p = abbr ? PARK_WIND[abbr] : undefined;
  if (!p || wind < p.min) return null;
  if (getStadiumForGame(game.homeTeamId, game.venue)?.international) return null;
  return `${p.park} wind: ${p.record}`;
}
