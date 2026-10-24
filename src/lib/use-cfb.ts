/**
 * College football data hooks for the /cfb pages. College teams aren't in the site's built-in
 * team list, so every hook registers the teams it receives before the page renders them.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/games";
import { registerTeams, teamById, type Team } from "@/data/teams";
import { conferenceTeams, type CfbConference } from "./cfb";
import { getCfbConferences, getCfbRankings, getCfbSchedule } from "./cfb.functions";

/** The FBS regular season as site games (refreshed every 15 seconds while a game is live). */
export function useCfbSchedule(refetchMs: number | false = 60_000, enabled = true) {
  const query = useQuery({
    queryKey: ["cfb-schedule"],
    queryFn: () => getCfbSchedule(),
    enabled,
    // Every 15 seconds while a game is live, otherwise at the page's own pace.
    refetchInterval: (q) =>
      refetchMs === false
        ? false
        : Array.isArray(q.state.data) && q.state.data.some((g) => g.status === "live")
          ? Math.min(refetchMs, 15_000)
          : refetchMs,
    staleTime: 20_000,
    retry: 1,
  });
  const games: Game[] = useMemo(() => {
    const list = Array.isArray(query.data) ? query.data : [];
    for (const g of list) registerTeams(g.teamRefs);
    return list;
  }, [query.data]);
  return { ...query, games };
}

/** FBS conferences (standings), with their teams registered as site teams. */
export function useCfbConferences(enabled = true) {
  const query = useQuery({
    queryKey: ["cfb-conferences"],
    queryFn: () => getCfbConferences(),
    enabled,
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const conferences: CfbConference[] = useMemo(() => {
    const list = Array.isArray(query.data) ? query.data : [];
    registerTeams(conferenceTeams(list));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);
  return { ...query, conferences };
}

/** This week's AP Top 25 (or the CFP rankings once released), as site teams in order. */
export function useCfbTop25() {
  const query = useQuery({
    queryKey: ["cfb-rankings"],
    queryFn: () => getCfbRankings(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const poll = useMemo(() => {
    const polls = query.data ?? [];
    return polls.find((r) => /playoff|cfp/i.test(r.poll)) ?? polls[0];
  }, [query.data]);
  const ranks = useMemo(
    () =>
      (poll?.ranks ?? []).slice(0, 25).map((r) => {
        const id = `cfb-${r.team.id}`;
        const team: Team = teamById(id) ?? {
          id,
          espnId: r.team.id,
          league: "cfb",
          abbr: r.team.abbr,
          city: r.team.location,
          name: r.team.name,
          conference: "",
          division: "",
          color: r.team.color ? `#${r.team.color}` : "#8899aa",
          record: { w: 0, l: 0, t: 0 },
          pointsFor: 0,
          pointsAgainst: 0,
          logo: r.team.logo,
        };
        return { ...r, team };
      }),
    [poll],
  );
  return { ...query, poll: poll?.poll, ranks };
}

/** "all", "top25", or a conference (its short name, as on site teams). */
export type CfbScope = string;

/** Games in a scope: every FBS game, games with a ranked team, or one conference's games. */
export function scopeGames(games: Game[], scope: CfbScope): Game[] {
  if (scope === "all") return games;
  if (scope === "top25") return games.filter((g) => g.awayRank || g.homeRank);
  return games.filter(
    (g) =>
      teamById(g.awayTeamId)?.conference === scope || teamById(g.homeTeamId)?.conference === scope,
  );
}

/** The week to open on: the first with games still to play, else the last one. */
export function currentCfbWeek(games: Game[]): number | null {
  if (!games.length) return null;
  const open = games.filter((g) => g.status !== "final").map((g) => g.week);
  return open.length ? Math.min(...open) : Math.max(...games.map((g) => g.week));
}
