import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/shared/games";
import { isCollegeId, type Team } from "@/data/shared/teams";
import { DraftKingsPropsBoard } from "@/components/shared/DraftKingsPropsBoard";
import { GamePropLines, type PropExtraTab } from "@/components/shared/PropHistory";
import { TdScorers, tdName } from "@/components/shared/TdScorers";
import { PropSpecials } from "@/components/shared/PropSpecials";
import {
  getClosedProps,
  getLiveProps,
  getPregameProps,
  getPropHistory,
  getUpcomingProps,
} from "@/lib/shared/prop-history.functions";
import type {
  PropHistoryGame,
  SpecialResult,
  SpecialRow,
  UpcomingPropGame,
} from "@/lib/shared/prop-history.server";

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

/** Each yes-only bet's result in a finished game, keyed "player|bet". */
export function specialResultsOf(game: PropHistoryGame | undefined) {
  const out = new Map<string, SpecialResult>();
  for (const r of game?.sp ?? []) out.set(`${r[0]}|${r[2]}`, r[5]);
  return out;
}

/**
 * A game's touchdowns so far (normalized player name → TDs) and its first TD scorer (normalized name, ""
 * for a player not on the box score, null before any TD), from the live / final numbers.
 */
function touchdownResults(stats: [string, string, number | "dnp"][] | undefined) {
  if (!stats) return { touchdowns: undefined, firstScorer: undefined };
  const touchdowns = new Map<string, number>();
  let firstScorer: string | null = null;
  let decided = false;
  for (const [player, label, v] of stats) {
    if (label === "Anytime TD" && typeof v === "number") touchdowns.set(tdName(player), v);
    if (label === "First TD" && typeof v === "number") {
      decided = true;
      if (v === 1) firstScorer = tdName(player);
    }
  }
  return { touchdowns, firstScorer: decided ? (firstScorer ?? "") : null };
}

/** A history-only game (no closing board saved) in the table's shape: the sportsbook's opening line. */
/** Where the yes-only bets sit among the props tabs: DraftKings leads with goalscorers, the rest go last. */
function specialsTab(league: string, node: React.ReactNode): PropExtraTab {
  return league === "nhl"
    ? { label: "Goalscorers", node, first: true }
    : { label: "Specials", node };
}

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
 * where each opened.
 * - Live: each player's numbers so far from ESPN's live box score, graded like finished games
 *   (getLiveProps), every 20 seconds; before the closing board is saved, the last pregame board.
 * - Final: each player's result from the prop history, or from the final box score until the history
 *   has the game.
 * Falls back to the prop history (opening lines with results) when no closing board was saved, and to
 * `fallback` when nothing exists.
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
  // live numbers: while the game is on, and after it until the prop history has it (always for the
  // NFL: the history doesn't keep the touchdown-scorer bets)
  const useLive =
    /^\d+$/.test(game.id) &&
    (!final || league === "nfl" || (!history.isLoading && !past?.props.length));
  const live = useQuery({
    queryKey: ["live-props", league, game.id],
    queryFn: () => getLiveProps({ data: { league, id: game.id } }),
    enabled: useLive,
    refetchInterval: final ? false : 20_000,
    staleTime: final ? 5 * 60_000 : 10_000,
  });
  // the last pregame board while the closing one isn't saved yet
  const pregame = useQuery({
    queryKey: ["pregame-props", league, game.id],
    queryFn: () => getPregameProps({ data: { league, id: game.id } }),
    enabled: !final && /^\d+$/.test(game.id) && !closed.isLoading && !closed.data,
    staleTime: 5 * 60_000,
  });
  const board = closed.data ?? pregame.data ?? undefined;
  const results = useMemo(() => {
    if (past?.props.length) return resultsOf(past);
    const m = new Map<string, number | null | "dnp">();
    for (const [player, label, v] of live.data?.stats ?? []) m.set(`${player}|${label}`, v);
    return m;
  }, [past, live.data]);
  const td = useMemo(() => touchdownResults(live.data?.stats), [live.data]);
  const spResults = useMemo(() => {
    if (past?.sp?.length) return specialResultsOf(past);
    return new Map<string, SpecialResult>(
      (live.data?.specials ?? []).map(([p, label, r]) => [`${p}|${label}`, r]),
    );
  }, [past, live.data]);
  const inPlay = !final && live.data?.state !== "post";

  // don't flash the fallback while the pregame board loads
  if (closed.isLoading || history.isLoading || (!closed.data && pregame.isLoading))
    return <Loading />;
  const sp: SpecialRow[] | undefined =
    board?.sp ?? past?.sp?.map((r) => [r[0], r[1], r[2], r[3], r[4]] as SpecialRow);
  const away = board?.away.abbr ?? past?.away.abbr ?? game.away;
  const home = board?.home.abbr ?? past?.home.abbr ?? game.home;
  const tdProps = {
    game: board!,
    touchdowns: live.data ? td.touchdowns : undefined,
    firstScorer: live.data ? td.firstScorer : undefined,
    live: inPlay,
  };
  const hasTd = !!board?.td?.length;
  const hasSp = !!sp?.length;
  const extraTabs: PropExtraTab[] = [];
  if (hasTd)
    extraTabs.push({ label: "TD Scorers", node: <TdScorers bare {...tdProps} />, first: true });
  if (hasSp)
    extraTabs.push(
      specialsTab(
        league,
        <PropSpecials
          bare
          league={league}
          away={away}
          home={home}
          rows={sp}
          results={spResults}
          closing
        />,
      ),
    );
  let lines: React.ReactNode = null;
  if (board?.props.length)
    lines = (
      <GamePropLines
        league={league}
        game={board}
        title={inPlay ? "Player props · live" : "Player props"}
        sub={
          inPlay
            ? `DraftKings ${closed.data ? "closing" : "last pregame"} lines · each player's numbers so far${live.data?.detail ? ` · ${live.data.detail}` : ""}`
            : "DraftKings closing lines · where each line opened · what each player did"
        }
        results={results}
        live={inPlay}
        extraTabs={extraTabs}
      />
    );
  else if (past?.props.length)
    lines = (
      <GamePropLines
        league={league}
        game={fromHistory(past)}
        title="Player props"
        sub="The sportsbook's opening lines (no closing lines were saved for this game) · what each player did"
        results={results}
        lineLabel="Line"
        extraTabs={extraTabs}
      />
    );
  if (lines) return <div className="space-y-6">{lines}</div>;
  // no over/under lines: the yes-only boards stand on their own
  if (!hasTd && !hasSp) return <>{fallback}</>;
  return (
    <div className="space-y-6">
      {hasTd ? <TdScorers {...tdProps} /> : null}
      {hasSp ? (
        <PropSpecials
          league={league}
          away={away}
          home={home}
          rows={sp}
          results={spResults}
          closing
        />
      ) : null}
    </div>
  );
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
  if (!lines?.props.length && !lines?.sp?.length) return <>{fallback}</>;
  return (
    <div className="space-y-6">
      {lines.props.length ? (
        <GamePropLines
          league={league}
          game={lines}
          title="Player props"
          sub="DraftKings lines · where each line opened · tap ▾ for alternate lines"
          extraTabs={
            lines.sp?.length
              ? [
                  specialsTab(
                    league,
                    <PropSpecials
                      bare
                      league={league}
                      away={lines.away.abbr}
                      home={lines.home.abbr}
                      rows={lines.sp}
                    />,
                  ),
                ]
              : []
          }
        />
      ) : (
        <PropSpecials
          league={league}
          away={lines.away.abbr}
          home={lines.home.abbr}
          rows={lines.sp}
        />
      )}
    </div>
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
            extraTabs={
              lines.td?.length
                ? [{ label: "TD Scorers", node: <TdScorers bare game={lines} />, first: true }]
                : []
            }
          />
        ) : (
          <TdScorers game={lines} />
        )}
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
