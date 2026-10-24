/**
 * League-aware links and images, so the same components serve NFL and college pages.
 *
 * Game and team ids say which league they belong to (college ids start with "cfb-"). Player ids
 * are ESPN's bare numbers in both leagues, so player links follow the page's league instead.
 */

import { useRouterState } from "@tanstack/react-router";
import { isCollegeId, type Team } from "@/data/teams";
import { leagueFromPath, type LeagueId } from "./leagues";

/** The league of the page being viewed. */
export function useLeague(): LeagueId {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return leagueFromPath(pathname).id;
}

export const gameRoute = (gameId: string) =>
  isCollegeId(gameId) ? ("/cfb/games/$gameId" as const) : ("/games/$gameId" as const);

export const teamRoute = (teamId: string) =>
  isCollegeId(teamId) ? ("/cfb/teams/$teamId" as const) : ("/teams/$teamId" as const);

export const playerRoute = (league: LeagueId) =>
  league === "cfb" ? ("/cfb/players/$playerId" as const) : ("/players/$playerId" as const);

/** ESPN headshot for a player id. */
export const headshotUrl = (league: LeagueId, playerId: string) =>
  playerId
    ? `https://a.espncdn.com/i/headshots/${
        league === "cfb" ? "college-football" : "nfl"
      }/players/full/${playerId}.png`
    : "";

/**
 * How the server looks a team up: NFL teams by abbreviation, college teams by id (abbreviations
 * repeat across the 130+ FBS schools and the NFL).
 */
export const teamKey = (team: Team) => (isCollegeId(team.id) ? team.id : team.abbr);

/** "#5 Ohio State" style label for a college side; plain name otherwise. */
export const rankedName = (team: Team, rank?: number) =>
  `${rank ? `#${rank} ` : ""}${isCollegeId(team.id) ? team.city : team.name}`;

/** The name tables show: "Ohio State" for a college team, "Chiefs" for an NFL team. */
export const teamShort = (team: Team) => (isCollegeId(team.id) ? team.city : team.name);
