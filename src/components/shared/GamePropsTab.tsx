import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/shared/games";
import { isCollegeId, type Team } from "@/data/shared/teams";
import { DraftKingsPropsBoard } from "@/components/shared/DraftKingsPropsBoard";
import { GamePropLines } from "@/components/shared/PropHistory";
import { getUpcomingProps } from "@/lib/shared/prop-history.functions";
import type { UpcomingPropGame } from "@/lib/shared/prop-history.server";

/** The saved DraftKings lines for this game, matched by ESPN event id (else by the two teams). */
export function findPropGame(games: UpcomingPropGame[], game: Game, away: Team, home: Team) {
  const id = game.id.replace(/^\D+-/, "");
  return (
    games.find((g) => g.id === id) ??
    games.find(
      (g) =>
        g.away.abbr.toUpperCase() === away.abbr.toUpperCase() &&
        g.home.abbr.toUpperCase() === home.abbr.toUpperCase() &&
        Math.abs(Date.parse(g.date) - Date.parse(game.kickoffIso ?? g.date)) < 2 * 86_400_000,
    )
  );
}

/**
 * The game page's Props tab. NFL games before kickoff: the Prop lines table (line, where it opened, the
 * move, prices, alternate lines). Anything else, or an NFL game with no saved lines yet: ESPN's live
 * DraftKings board.
 */
export function GamePropsTab({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const nfl = !isCollegeId(game.id);
  const q = useQuery({
    queryKey: ["upcoming-props", "nfl"],
    queryFn: () => getUpcomingProps({ data: { league: "nfl" } }),
    enabled: nfl && game.status === "scheduled",
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const lines = q.data ? findPropGame(q.data, game, away, home) : undefined;
  if (nfl && game.status === "scheduled" && q.isLoading)
    return (
      <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
        Loading prop lines…
      </p>
    );
  if (lines?.props.length)
    return (
      <GamePropLines
        league="nfl"
        game={lines}
        title="Player props"
        sub="DraftKings lines · where each line opened · tap ▾ for alternate lines"
      />
    );
  return <DraftKingsPropsBoard game={game} away={away} home={home} />;
}
