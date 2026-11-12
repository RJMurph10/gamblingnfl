import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/shared/games";
import { isCollegeId, type Team } from "@/data/shared/teams";
import { DraftKingsPropsBoard } from "@/components/shared/DraftKingsPropsBoard";
import { GamePropLines } from "@/components/shared/PropHistory";
import { TdScorers, tdName } from "@/components/shared/TdScorers";
import {
  getClosedProps,
  getPropHistory,
  getUpcomingProps,
} from "@/lib/shared/prop-history.functions";
import type { PropHistoryGame, UpcomingPropGame } from "@/lib/shared/prop-history.server";

/** A game as the props files know it: ESPN event id, start time and the two teams' abbreviations. */
export interface PropGameRef {
  id: string;
  date: string;
  away: string;
  home: string;
}

/** The saved lines for this game, matched by ESPN event id (else by the two teams within two days). */
export function findPropGame<
  G extends { id: string; date: string; away: { abbr: string }; home: { abbr: string } },
>(games: G[], ref: PropGameRef): G | undefined {
  return (
    games.find((g) => g.id === ref.id) ??
    games.find(
      (g) =>
        g.away.abbr.toUpperCase() === ref.away.toUpperCase() &&
        g.home.abbr.toUpperCase() === ref.home.toUpperCase() &&
        Math.abs(Date.parse(g.date) - Date.parse(ref.date || g.date)) < 2 * 86_400_000,
    )
  );
}

/** The NFL game page's reference for a game ("espn-401…" ids). */
export function nflRef(game: Game, away: Team, home: Team): PropGameRef {
  return {
    id: game.id.replace(/^\D+-/, ""),
    date: game.kickoffIso ?? "",
    away: away.abbr,
    home: home.abbr,
  };
}

/**
 * Where the prop history keeps a game: its day (US date, UTC−5) and season — the NFL season is the
 * year it starts ("2026"), MLB's is its calendar year, the NBA's and NHL's span two years ("2026-27").
 */
export function historyKey(startIso: string, league: "nfl" | "nba" | "nhl" | "mlb" = "nfl") {
  const t = Date.parse(startIso) - 5 * 3_600_000;
  const day = new Date(t).toISOString().slice(0, 10);
  const [y, m] = day.split("-").map(Number);
  if (league === "nba" || league === "nhl") {
    const start = m >= 8 ? y : y - 1;
    return { season: `${start}-${String((start + 1) % 100).padStart(2, "0")}`, day };
  }
  if (league === "mlb") return { season: String(y), day };
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
 * A started or finished game's props: DraftKings' closing lines (the last ones before the start) with
 * where each opened, and each player's result once the game is final. Falls back to the prop history
 * (opening lines with results) when no closing board was saved, and to `fallback` when neither exists.
 */
export function ClosedPropLines({
  league,
  game,
  final,
  fallback,
}: {
  league: "nfl" | "nba" | "nhl" | "mlb";
  game: PropGameRef;
  final: boolean;
  fallback: React.ReactNode;
}) {
  const hk = game.date ? historyKey(game.date, league) : null;
  const closed = useQuery({
    queryKey: ["closed-props", league, game.id],
    queryFn: () => getClosedProps({ data: { league, id: game.id } }),
    enabled: /^\d+$/.test(game.id),
    // a game whose closing lines aren't saved yet (the lines job runs hourly) is checked again soon,
    // instead of keeping "none" for half an hour
    staleTime: (q) => (q.state.data ? 30 * 60_000 : 60_000),
    refetchInterval: (q) => (q.state.data ? false : 2 * 60_000),
  });
  const history = useQuery({
    queryKey: ["prop-history", league, hk?.season ?? "", hk?.day ?? ""],
    queryFn: () => getPropHistory({ data: { league, season: hk!.season, day: hk!.day } }),
    enabled: final && hk !== null,
    staleTime: 10 * 60_000,
  });
  const past = useMemo(
    () =>
      history.data?.day === hk?.day ? findPropGame(history.data?.games ?? [], game) : undefined,
    [history.data, hk?.day, game],
  );
  const results = useMemo(() => resultsOf(past), [past]);

  if (closed.isLoading || history.isLoading) return <Loading />;
  if (closed.data?.props.length)
    return (
      <GamePropLines
        league={league}
        game={closed.data}
        title="Player props"
        sub={
          final
            ? "DraftKings closing lines · where each line opened · what each player did"
            : "DraftKings closing lines · results fill in after the game"
        }
        results={results}
      />
    );
  if (past?.props.length)
    return (
      <GamePropLines
        league={league}
        game={fromHistory(past)}
        title="Player props"
        sub="The sportsbook's opening lines (no closing lines were saved for this game) · what each player did"
        results={results}
        lineLabel="Line"
      />
    );
  return <>{fallback}</>;
}

/**
 * An upcoming game's props: DraftKings' current lines with where each opened, from the saved board
 * the Prop lines page uses. `fallback` when this game has no lines posted yet.
 */
export function UpcomingPropLines({
  league,
  game,
  fallback,
}: {
  league: "nfl" | "nba" | "nhl" | "mlb";
  game: PropGameRef;
  fallback: React.ReactNode;
}) {
  const upcoming = useQuery({
    queryKey: ["upcoming-props", league],
    queryFn: () => getUpcomingProps({ data: { league } }),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  if (upcoming.isLoading) return <Loading />;
  const lines = upcoming.data ? findPropGame(upcoming.data, game) : undefined;
  if (!lines?.props.length) return <>{fallback}</>;
  return (
    <GamePropLines
      league={league}
      game={lines}
      title="Player props"
      sub="DraftKings lines · where each line opened · tap ▾ for alternate lines"
    />
  );
}

/**
 * The NFL game page's Props tab:
 * - before kickoff: the Prop lines table (line, where it opened, the move, prices, alternate lines);
 * - started or finished: the closing lines with each player's result (ClosedPropLines).
 * College games, or NFL games with no saved lines: ESPN's live DraftKings board.
 */
export function GamePropsTab({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const nfl = !isCollegeId(game.id);
  const before = game.status === "scheduled";
  const ref = nflRef(game, away, home);
  const upcoming = useQuery({
    queryKey: ["upcoming-props", "nfl"],
    queryFn: () => getUpcomingProps({ data: { league: "nfl" } }),
    enabled: nfl && before,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const board = <DraftKingsPropsBoard game={game} away={away} home={home} />;
  if (!nfl) return board;
  if (!before)
    return (
      <div className="space-y-6">
        <ClosedPropLines league="nfl" game={ref} final={game.status === "final"} fallback={board} />
        <ClosedTdScorers game={game} id={ref.id} />
      </div>
    );
  if (upcoming.isLoading) return <Loading />;
  const lines = upcoming.data ? findPropGame(upcoming.data, ref) : undefined;
  if (lines?.props.length || lines?.td?.length)
    return (
      <div className="space-y-6">
        {lines.props.length ? (
          <GamePropLines
            league="nfl"
            game={lines}
            title="Player props"
            sub="DraftKings lines · where each line opened · tap ▾ for alternate lines"
          />
        ) : null}
        <TdScorers game={lines} />
      </div>
    );
  return board;
}

/** Box-score stats that count toward a touchdown-scorer bet (passing TDs don't). */
const SCORING_TDS = [
  "rushingTouchdowns",
  "receivingTouchdowns",
  "kickReturnTouchdowns",
  "puntReturnTouchdowns",
];

/**
 * Touchdowns each player scored, from the box score's raw ESPN stats (rushing, receiving, kick and
 * punt returns), summed across a player's lines (a back's rushing and receiving lines).
 */
export function touchdownsByPlayer(lines: { name: string; stats?: Record<string, string> }[]) {
  const m = new Map<string, number>();
  for (const l of lines) {
    let n = 0;
    for (const k of SCORING_TDS) n += Number(l.stats?.[k]) || 0;
    const key = tdName(l.name);
    m.set(key, (m.get(key) ?? 0) + n);
  }
  return m;
}

/** A started or finished NFL game's touchdown-scorer prices (last pull before kickoff) and who scored. */
function ClosedTdScorers({ game, id }: { game: Game; id: string }) {
  const closed = useQuery({
    queryKey: ["closed-props", "nfl", id],
    queryFn: () => getClosedProps({ data: { league: "nfl", id } }),
    enabled: /^\d+$/.test(id),
    staleTime: (q) => (q.state.data ? 30 * 60_000 : 60_000),
  });
  const touchdowns = useMemo(() => {
    if (game.status !== "final") return undefined;
    return touchdownsByPlayer(game.boxScore ?? []);
  }, [game.status, game.boxScore]);
  if (!closed.data?.td?.length) return null;
  return <TdScorers game={closed.data} touchdowns={touchdowns} />;
}
