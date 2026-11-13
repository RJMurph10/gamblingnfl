import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Game } from "@/data/shared/games";
import { isCollegeId, type Team } from "@/data/shared/teams";
import { DraftKingsPropsBoard } from "@/components/shared/DraftKingsPropsBoard";
import { GamePropLines } from "@/components/shared/PropHistory";
import { tdName } from "@/components/shared/TdScorers";
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

/** Touchdown-scorer bets as rows of the props table: anytime = over 0.5 TDs, 2+ = over 1.5, first / last TD. */
const TD_ROWS: [label: string, col: 2 | 3 | 4 | 5, line: number][] = [
  ["Anytime TD", 2, 0.5],
  ["2+ TDs", 4, 1.5],
  ["First TD", 3, 0.5],
  ["Last TD", 5, 0.5],
];
export const TD_LABELS = new Set(TD_ROWS.map(([l]) => l));

/** A board with its touchdown-scorer prices folded into the props (and the separate list dropped). */
export function withTdRows<G extends UpcomingPropGame>(g: G): G {
  if (!g.td?.length) return g;
  const extra: UpcomingPropGame["props"] = [];
  for (const r of g.td)
    for (const [label, col, line] of TD_ROWS) {
      const price = r[col];
      if (price != null) extra.push([r[0], r[1], label, line, price, null, null]);
    }
  return { ...g, props: [...g.props, ...extra], td: undefined };
}

/**
 * Live / final numbers keyed "player|market", with touchdown-scorer rows matched by name (the TD prices
 * come from another feed, so "Robert Henry" has to find the box score's "Robert Henry Jr.").
 */
function liveResults(
  stats: [string, string, number | "dnp"][],
  rows: UpcomingPropGame["props"],
): Map<string, number | null | "dnp"> {
  const m = new Map<string, number | null | "dnp">();
  const byName = new Map<string, number | "dnp">();
  for (const [player, label, v] of stats) {
    m.set(`${player}|${label}`, v);
    if (TD_LABELS.has(label)) byName.set(`${tdName(player)}|${label}`, v);
  }
  for (const r of rows)
    if (TD_LABELS.has(r[2]) && !m.has(`${r[0]}|${r[2]}`)) {
      const v = byName.get(`${tdName(r[0])}|${r[2]}`);
      if (v !== undefined) m.set(`${r[0]}|${r[2]}`, v);
    }
  return m;
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
  const rawBoard = closed.data ?? pregame.data ?? undefined;
  const board = useMemo(() => (rawBoard ? withTdRows(rawBoard) : undefined), [rawBoard]);
  const results = useMemo(() => {
    const m = liveResults(live.data?.stats ?? [], board?.props ?? []);
    if (past?.props.length) for (const [k, v] of resultsOf(past)) m.set(k, v);
    return m;
  }, [past, live.data, board]);
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
  const specials = sp?.length ? (
    <PropSpecials league={league} away={away} home={home} rows={sp} results={spResults} closing />
  ) : null;
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
      />
    );
  if (!lines && !specials) return <>{fallback}</>;
  return (
    <div className="space-y-6">
      {lines}
      {specials}
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
        />
      ) : null}
      <PropSpecials league={league} away={lines.away.abbr} home={lines.home.abbr} rows={lines.sp} />
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
  const found = upcoming.data ? findPropGame(upcoming.data, ref) : undefined;
  const lines = found ? withTdRows(found) : undefined;
  if (lines?.props.length)
    return (
      <GamePropLines
        league="nfl"
        game={lines}
        title="Player props"
        sub="DraftKings lines · where each line opened · tap ▾ for alternate lines · TD scorers under the Anytime TD, 2+ TDs, First TD and Last TD markets"
      />
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
