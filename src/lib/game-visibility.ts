import type { Game } from "@/data/games";

export function showGameStatistics(status: Game["status"]): boolean {
  return status === "live" || status === "final";
}