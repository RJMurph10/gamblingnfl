/**
 * Stadiums where wind unders have beaten the league's (claude/nfl-stadium-wind.md; closing totals,
 * nflverse 1999-2026). League, every other outdoor park: windy (10+ mph) unders 53-56%.
 * Shown as a note on those parks' ★ wind unders; the ★ itself is the same league-wide rule.
 */
import type { Game } from "@/data/shared/games";
import { teamById } from "@/data/shared/teams";
import { getStadiumForGame } from "./stadiums";

interface ParkWind {
  park: string;
  /** Only with rain forecast during the game. */
  rain?: boolean;
  /** The wind band the record is for (mph, inclusive min, exclusive max). */
  min: number;
  max?: number;
  record: string;
}

export const PARK_WIND: Record<string, ParkWind> = {
  PHI: { park: "Linc", min: 10, record: "unders 31-7 since 2016 (50-27 since 2003)" },
  BAL: { park: "M&T Bank", min: 15, record: "unders 15-7 at 15+ mph, ~6 pts under" },
  JAX: { park: "EverBank", min: 10, max: 15, record: "unders 37-25 at 10-15 mph" },
  TB: {
    park: "Raymond James",
    min: 10,
    rain: true,
    record: "wind + rain unders 6-0, ~13 pts under (small sample)",
  },
};

/** Wind + rain, league-wide (hourly stadium rain 2000-20; 2021-25 rain-noted games 17-4). */
export const WIND_RAIN_NOTE = "wind + rain: unders 140-77 (65%)";

/** The park's wind record for an NFL home game at its own stadium, when the wind is in its band. */
export function parkWindNote(
  game: Game,
  wind: number | null | undefined,
  rain = false,
): string | null {
  if (wind === null || wind === undefined || game.homeTeamId.startsWith("cfb-")) return null;
  const abbr = teamById(game.homeTeamId)?.abbr;
  const p = abbr ? PARK_WIND[abbr] : undefined;
  if (!p || wind < p.min || (p.max !== undefined && wind >= p.max) || (p.rain && !rain))
    return null;
  if (getStadiumForGame(game.homeTeamId, game.venue)?.international) return null;
  return `${p.park} wind: ${p.record}`;
}
