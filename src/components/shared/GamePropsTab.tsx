import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/shared/games";
import { isCollegeId, type Team } from "@/data/shared/teams";
import { DraftKingsPropsBoard } from "@/components/shared/DraftKingsPropsBoard";
import { GamePropLines } from "@/components/shared/PropHistory";
import {
  getClosedProps,
  getPropHistory,
  getUpcomingProps,
} from "@/lib/shared/prop-history.functions";
import type { PropHistoryGame, UpcomingPropGame } from "@/lib/shared/prop-history.server";

/** The saved DraftKings lines for this game, matched by ESPN event id (else by the two teams). */
export function findPropGame<
  G extends { id: string; date: string; away: { abbr: string }; home: { abbr: string } },
>(games: G[], game: Game, away: Team, home: Team): G | undefined {
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

/** Where the prop history keeps a game: NFL season (the year it starts) and day (US date, UTC−5). */
export function historyKey(kickoffIso: string) {
  const t = Date.parse(kickoffIso) - 5 * 3_600_000;
  const day = new Date(t).toISOString().slice(0, 10);
  const [y, m] = day.split("-").map(Number);
  return { season: String(m >= 3 ? y : y - 1), day };
}

/** Each player's number in a finished game, keyed "player|market" ("dnp" = didn't play: void). */
export function resultsOf(game: PropHistoryGame | undefined) {
  const out = new Map<string, number | null | "dnp">();
  for (const r of game?.props ?? []) out.set(`${r[0]}|${r[2]}`, r[7] ? "dnp" : r[6]);
  return out;
}

/** A history-only game (no closing board saved) in the table's shape: the sportsbook's opening line. */
function fromHistory(g: PropHistoryGame): UpcomingPropGame {
  return {
    id: g.id,
    date: g.date,
    name: g.name,
    away: { abbr: g.away.abbr, name: g.away.name },
    home: { abbr: g.home.abbr, name: g.home.name },
    props: g.props.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], null]),
  };
}

const Loading = () => (
  <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">
    Loading prop lines…
  </p>
);

/**
 * The game page's Props tab, for NFL games:
 * - before kickoff: the Prop lines table (line, where it opened, the move, prices, alternate lines);
 * - started or finished: the closing lines (the last ones before kickoff) with each player's result.
 * College games, or NFL games with no saved lines: ESPN's live DraftKings board.
 */
export function GamePropsTab({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const nfl = !isCollegeId(game.id);
  const before = game.status === "scheduled";
  const id = game.id.replace(/^\D+-/, "");
  const hk = game.kickoffIso ? historyKey(game.kickoffIso) : null;
  const upcoming = useQuery({
    queryKey: ["upcoming-props", "nfl"],
    queryFn: () => getUpcomingProps({ data: { league: "nfl" } }),
    enabled: nfl && before,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const closed = useQuery({
    queryKey: ["closed-props", "nfl", id],
    queryFn: () => getClosedProps({ data: { league: "nfl", id } }),
    enabled: nfl && !before && /^\d+$/.test(id),
    // a game whose closing lines aren't saved yet (the lines job runs hourly) is checked again soon,
    // instead of keeping "none" for half an hour
    staleTime: (q) => (q.state.data ? 30 * 60_000 : 60_000),
    refetchInterval: (q) => (q.state.data ? false : 2 * 60_000),
  });
  const history = useQuery({
    queryKey: ["prop-history", "nfl", hk?.season ?? "", hk?.day ?? ""],
    queryFn: () => getPropHistory({ data: { league: "nfl", season: hk!.season, day: hk!.day } }),
    enabled: nfl && game.status === "final" && hk !== null,
    staleTime: 10 * 60_000,
  });
  const past = useMemo(
    () =>
      history.data?.day === hk?.day
        ? findPropGame(history.data?.games ?? [], game, away, home)
        : undefined,
    [history.data, hk?.day, game, away, home],
  );
  const results = useMemo(() => resultsOf(past), [past]);

  if (nfl && before) {
    if (upcoming.isLoading) return <Loading />;
    const lines = upcoming.data ? findPropGame(upcoming.data, game, away, home) : undefined;
    if (lines?.props.length)
      return (
        <GamePropLines
          league="nfl"
          game={lines}
          title="Player props"
          sub="DraftKings lines · where each line opened · tap ▾ for alternate lines"
        />
      );
  }
  if (nfl && !before) {
    if (closed.isLoading || history.isLoading) return <Loading />;
    if (closed.data?.props.length)
      return (
        <GamePropLines
          league="nfl"
          game={closed.data}
          title="Player props"
          sub={
            game.status === "final"
              ? "DraftKings closing lines · where each line opened · what each player did"
              : "DraftKings closing lines · results fill in after the game"
          }
          results={results}
        />
      );
    if (past?.props.length)
      return (
        <GamePropLines
          league="nfl"
          game={fromHistory(past)}
          title="Player props"
          sub="The sportsbook's opening lines (no closing lines were saved for this game) · what each player did"
          results={results}
          lineLabel="Line"
        />
      );
  }
  return <DraftKingsPropsBoard game={game} away={away} home={home} />;
}
