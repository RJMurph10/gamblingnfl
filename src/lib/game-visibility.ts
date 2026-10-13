import type { Game } from "@/data/games";

/**
 * Gamecast / Stats / Markets tabs are available for every game, including
 * upcoming ones (they show empty states until the game starts).
 */
export function showGameStatistics(_status: Game["status"]): boolean {
  return true;
}
