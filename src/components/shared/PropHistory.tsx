/**
 * "Prop history": every player prop line the sportsbooks posted for past games (main line, opening
 * prices) next to what the player actually did. NBA from 2022-23, NFL from 2024 (2022-23 has mostly
 * touchdown props), refreshed daily during the season.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader, TeamLogo } from "@/components/shared/booth";
import { teamByAbbr } from "@/data/shared/teams";
import { getPropHistory, getUpcomingProps } from "@/lib/shared/prop-history.functions";
import { PropSpecials } from "@/components/shared/PropSpecials";
import type {
  PropHistoryGame,
  PropHistoryRow,
  PropLeague,
  UpcomingPropGame,
} from "@/lib/shared/prop-history.server";

const COVERAGE: Record<PropLeague, string> = {
  nfl: "Yardage, reception and attempt props from 2024; 2022–23 has mostly touchdown props. DraftKings prices for 2026 come from a weekly pull of the main yardage and reception props.",
  nba: "From the 2022–23 season on.",
  nhl: "Points, goals, assists, shots, hits, blocks and saves from the 2023–24 season on.",
  mlb: "Hitter props (hits, home runs, runs, RBIs) and pitcher props (strikeouts, outs, earned runs) from 2024 on.",
  wnba: "Points, rebounds, assists and threes for the 2025 season (ESPN BET). For 2024 there are none, and for 2026 DraftKings posted only milestone props (\"15+ points\"), which aren't over/under lines.",
};

const american = (n: number | null) => (n == null ? "—" : n > 0 ? `+${n}` : String(n));

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function result(r: PropHistoryRow): "over" | "under" | "push" | "void" | null {
  const [, , , line, , , actual, dnp] = r;
  if (dnp) return "void";
  if (actual == null) return null;
  return actual > line ? "over" : actual < line ? "under" : "push";
}

function ResultBadge({ r }: { r: PropHistoryRow }) {
  const res = result(r);
  if (!res) return <span className="text-faint">—</span>;
  const cls =
    res === "over"
      ? "bg-win/10 text-win ring-win/25"
      : res === "under"
        ? "bg-loss/10 text-loss ring-loss/25"
        : "bg-panel2 text-mute ring-line/10";
  return (
    <span
      className={`inline-block w-14 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider ring-1 ${cls}`}
    >
      {res}
    </span>
  );
}

function GameChip({
  game,
  league,
  selected,
  onSelect,
}: {
  game: PropHistoryGame;
  league: PropLeague;
  selected: boolean;
  onSelect: () => void;
}) {
  const aw = (game.away.score ?? 0) > (game.home.score ?? 0);
  const hw = (game.home.score ?? 0) > (game.away.score ?? 0);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${game.away.name} ${game.away.score ?? ""} at ${game.home.name} ${game.home.score ?? ""}, ${game.props.length} props`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs tabular-nums ring-1 transition ${
        selected
          ? "bg-acc/10 text-acc ring-acc/30"
          : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
      }`}
    >
      <span className={aw ? "font-semibold text-foreground" : ""}>{game.away.score ?? ""}</span>
      <PropTeam league={league} abbr={game.away.abbr} />
      <span className="text-faint">@</span>
      <PropTeam league={league} abbr={game.home.abbr} />
      <span className={hw ? "font-semibold text-foreground" : ""}>{game.home.score ?? ""}</span>
      <span className="ml-1 text-[10px] text-faint">{game.props.length} props</span>
    </button>
  );
}

function PastResults({ league, tabs }: { league: PropLeague; tabs: ReactNode }) {
  const [season, setSeason] = useState<string | undefined>();
  const [day, setDay] = useState<string | undefined>();
  const [gameId, setGameId] = useState<string | undefined>();
  const [market, setMarket] = useState("All");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["prop-history", league, season ?? "", day ?? ""],
    queryFn: () => getPropHistory({ data: { league, season, day } }),
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
  const data = q.data;
  const days = data?.days ?? [];
  const at = data?.day ? days.indexOf(data.day) : -1;
  const games = useMemo(() => data?.games ?? [], [data]);
  const game = games.find((g) => g.id === gameId) ?? games[0];
  const markets = useMemo(
    () => ["All", ...Array.from(new Set((game?.props ?? []).map((p) => p[2]))).sort()],
    [game],
  );
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (game?.props ?? []).filter(
      (p) => (market === "All" || p[2] === market) && (!s || p[0].toLowerCase().includes(s)),
    );
  }, [game, market, search]);

  const dayStats = useMemo(() => {
    const all = games.flatMap((g) => g.props);
    const graded = all.filter((r) => result(r) === "over" || result(r) === "under");
    const overs = graded.filter((r) => result(r) === "over").length;
    return { props: all.length, overPct: graded.length ? (100 * overs) / graded.length : null };
  }, [games]);

  const pickDay = (d: string | undefined) => {
    setDay(d);
    setGameId(undefined);
  };
  const L = league.toUpperCase();

  return (
    <>
      <PageTitle
        eyebrow={`${L} · Player props`}
        title="Prop lines"
        aside={
          data?.seasons?.length ? (
            <select
              value={data.season}
              onChange={(e) => {
                setSeason(e.target.value);
                pickDay(undefined);
              }}
              className="rounded-lg bg-panel2 px-3 py-1.5 font-mono text-xs ring-1 ring-line/10"
              aria-label="Season"
            >
              {data.seasons.map((s) => (
                <option key={s} value={s}>
                  {s} season
                </option>
              ))}
            </select>
          ) : null
        }
      />
      {tabs}
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-mute">
        Every player prop line the sportsbook posted, at its opening line and price, next to what
        the player actually did. {COVERAGE[league]} This season updates four times a day, so
        finished games show up the same night.
      </p>

      <Panel padded={false} className="mb-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          <button
            type="button"
            disabled={at <= 0}
            onClick={() => pickDay(days[at - 1])}
            className="rounded-lg px-2 py-1 font-mono text-xs text-acc ring-1 ring-line/10 disabled:opacity-30"
          >
            ‹ Prev
          </button>
          <select
            value={data?.day ?? ""}
            onChange={(e) => pickDay(e.target.value)}
            className="rounded-lg bg-panel2 px-3 py-1.5 font-mono text-xs ring-1 ring-line/10"
            aria-label="Day"
          >
            {days
              .slice()
              .reverse()
              .map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={at < 0 || at >= days.length - 1}
            onClick={() => pickDay(days[at + 1])}
            className="rounded-lg px-2 py-1 font-mono text-xs text-acc ring-1 ring-line/10 disabled:opacity-30"
          >
            Next ›
          </button>
          <span className="ml-auto font-mono text-[11px] text-mute">
            {q.isLoading
              ? "Loading…"
              : `${games.length} ${games.length === 1 ? "game" : "games"} · ${dayStats.props} props${
                  dayStats.overPct !== null ? ` · overs hit ${dayStats.overPct.toFixed(0)}%` : ""
                }`}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {games.map((g) => (
            <GameChip
              key={g.id}
              game={g}
              league={league}
              selected={g.id === game?.id}
              onSelect={() => {
                setGameId(g.id);
                setMarket("All");
              }}
            />
          ))}
          {!games.length && !q.isLoading ? (
            <p className="font-mono text-xs text-mute">No prop history for this day.</p>
          ) : null}
        </div>
      </Panel>

      {game ? (
        <Panel padded={false}>
          <PanelHeader
            title={`${game.away.name} ${game.away.score ?? ""} @ ${game.home.name} ${game.home.score ?? ""}`}
            aside={
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a player"
                className="w-40 rounded-lg bg-panel2 px-3 py-1.5 font-mono text-xs ring-1 ring-line/10"
              />
            }
          />
          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {markets.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarket(m)}
                className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  market === m
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Prop</th>
                  <th className="px-2 py-2 text-right font-normal">Line</th>
                  <th className="px-2 py-2 text-right font-normal">Over</th>
                  <th className="px-2 py-2 text-right font-normal">Under</th>
                  <th className="px-2 py-2 text-right font-normal">Actual</th>
                  <th className="px-4 py-2 text-right font-normal">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {rows.map((r, i) => (
                  <tr key={`${r[0]}-${r[2]}-${i}`} className="hover:bg-line/5">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        {r[0]} <PropTeam league={league} abbr={r[1]} />
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-mute">{r[2]}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {r[3]}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                      {american(r[4])}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                      {american(r[5])}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {r[6] ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ResultBadge r={r} />
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center font-mono text-xs text-mute">
                      No props match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            Opening line and prices; "—" means the sportsbook listed the line without a price.
            Source: ESPN's odds feed (DraftKings, else ESPN BET or another book).
          </p>
        </Panel>
      ) : null}
      {game?.sp?.length ? (
        <div className="mt-6">
          <PropSpecials
            key={`sp-${game.id}`}
            league={league}
            away={game.away.abbr}
            home={game.home.abbr}
            rows={game.sp.map((r) => [r[0], r[1], r[2], r[3], r[4]])}
            results={new Map(game.sp.map((r) => [`${r[0]}|${r[2]}`, r[5]]))}
            closing
          />
        </div>
      ) : null}
    </>
  );
}

const kickoff = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const boardKey = (league: PropLeague) => `upcoming-props:${league}`;
function readSavedBoard(league: PropLeague): UpcomingPropGame[] | null {
  if (typeof window === "undefined") return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(boardKey(league)) ?? "null");
    return Array.isArray(v) ? (v as UpcomingPropGame[]) : null;
  } catch {
    return null;
  }
}
function saveBoard(league: PropLeague, games: UpcomingPropGame[]) {
  try {
    window.localStorage.setItem(boardKey(league), JSON.stringify(games));
  } catch {
    // storage full or blocked: the board still works, it just won't be remembered
  }
}

function Upcoming({ league, tabs }: { league: PropLeague; tabs: ReactNode }) {
  const [gameId, setGameId] = useState<string | undefined>();
  // The games don't change between refreshes, only prices: remember the last board in this browser
  // and show it at once on reload (and if a refresh comes back empty) instead of a blank page.
  const [saved, setSaved] = useState<UpcomingPropGame[] | null>(null);
  useEffect(() => setSaved(readSavedBoard(league)), [league]);
  const q = useQuery({
    queryKey: ["upcoming-props", league],
    queryFn: async () => {
      const fresh = await getUpcomingProps({ data: { league } });
      if (fresh.length) saveBoard(league, fresh);
      return fresh;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 2,
    placeholderData: (prev) => prev,
  });
  const games: UpcomingPropGame[] = useMemo(() => {
    if (q.data?.length) return q.data;
    const now = Date.now();
    return (saved ?? []).filter((g) => Date.parse(g.date) > now);
  }, [q.data, saved]);
  const game = games.find((g) => g.id === gameId) ?? games[0];
  const L = league.toUpperCase();
  return (
    <>
      <PageTitle eyebrow={`${L} · Player props`} title="Prop lines" />
      {tabs}
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-mute">
        DraftKings player lines for upcoming games, with where each line opened. Updated every few
        hours, and hourly just before games. NFL lines appear a few days early; NBA, NHL and MLB
        lines usually on game day.
      </p>
      <Panel padded={false} className="mb-6">
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameId(g.id)}
              aria-label={`${g.away.name} at ${g.home.name}, ${g.props.length} props`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-left font-mono text-xs ring-1 transition ${
                g.id === game?.id
                  ? "bg-acc/10 text-acc ring-acc/30"
                  : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
              }`}
            >
              <PropTeam league={league} abbr={g.away.abbr} />
              <span className="text-faint">@</span>
              <PropTeam league={league} abbr={g.home.abbr} />
              <span className="ml-1 text-[10px] text-faint" suppressHydrationWarning>
                {kickoff(g.date)} ·{" "}
                {g.props.length || !g.sp?.length
                  ? `${g.props.length} props`
                  : `${g.sp.length} specials`}
              </span>
            </button>
          ))}
          {!games.length ? (
            <p className="font-mono text-xs text-mute">
              {q.isLoading ? "Loading lines…" : "No player lines posted for upcoming games yet."}
            </p>
          ) : null}
        </div>
      </Panel>
      {game?.props.length ? (
        <GamePropLines
          key={game.id}
          league={league}
          game={game}
          title={`${game.away.name} @ ${game.home.name}`}
        />
      ) : null}
      {game?.sp?.length ? (
        <div className="mt-6">
          <PropSpecials
            key={`sp-${game.id}`}
            league={league}
            away={game.away.abbr}
            home={game.home.abbr}
            rows={game.sp}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * One game's DraftKings player lines: team and market filters, a player search, the line against where
 * it opened, and each prop's alternate lines. Used by the Prop lines page and the NFL game page's Props tab.
 */
export function GamePropLines({
  league,
  game,
  title,
  sub,
  results,
  lineLabel,
}: {
  league: PropLeague;
  game: UpcomingPropGame;
  title: string;
  sub?: string;
  /**
   * Finished games: what each player did, keyed "player|market". Adds a Result column, and the lines
   * are read as the closing lines.
   */
  results?: Map<string, number | null | "dnp">;
  /** Header for the line column (default: "Close" with results, else "Line"). */
  lineLabel?: string;
}) {
  const graded = results !== undefined;
  /** Results against the closing board (not a history-only game shown at its opening line). */
  const closing = graded && lineLabel === undefined;
  /** Games shown from the prop history alone have no opening line: drop Opened and Move then. */
  const hasOpen = game.props.some((p) => p[6] != null);
  const cols = (graded ? 8 : 7) - (hasOpen ? 0 : 2);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // the ladder spans the visible width of the (horizontally scrolling) table, not the whole table
  const wrap = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState<number | undefined>();
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [openKey]);
  const [team, setTeam] = useState("All");
  const [market, setMarket] = useState("All");
  const [search, setSearch] = useState("");
  const markets = useMemo(
    () => ["All", ...Array.from(new Set(game.props.map((p) => p[2]))).sort()],
    [game],
  );
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return game.props.filter(
      (p) =>
        (team === "All" || p[1] === team) &&
        (market === "All" || p[2] === market) &&
        (!s || p[0].toLowerCase().includes(s)),
    );
  }, [game, team, market, search]);
  return (
    <Panel padded={false}>
      <PanelHeader
        title={title}
        aside={
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a player"
            className="w-40 rounded-lg bg-panel2 px-3 py-1.5 font-mono text-xs ring-1 ring-line/10"
          />
        }
      />
      {sub ? <p className="px-4 pt-3 font-mono text-[10px] text-faint">{sub}</p> : null}
      {graded ? <OverUnderCount rows={rows} results={results} /> : null}
      <div className="flex gap-2 overflow-x-auto px-4 pt-3">
        {["All", game.away.abbr, game.home.abbr].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeam(t)}
            aria-pressed={team === t}
            aria-label={t === "All" ? "Both teams" : `${t} players`}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs ring-1 ${
              team === t
                ? "bg-acc/10 text-acc ring-acc/30"
                : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
            }`}
          >
            {t === "All" ? null : <PropTeam league={league} abbr={t} />}
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {markets.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMarket(m)}
            className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
              market === m
                ? "bg-acc/10 text-acc ring-acc/25"
                : "bg-panel2 text-mute ring-line/10 hover:text-acc"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <div ref={wrap} className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Player</th>
              <th className="px-2 py-2 font-normal">Prop</th>
              <th className="px-2 py-2 text-right font-normal">
                {lineLabel ?? (graded ? "Close" : "Line")}
              </th>
              {hasOpen ? (
                <>
                  <th className="px-2 py-2 text-right font-normal">Opened</th>
                  <th className="px-2 py-2 text-right font-normal">Move</th>
                </>
              ) : null}
              <th className="px-2 py-2 text-right font-normal">Over</th>
              <th className={`${graded ? "px-2" : "px-4"} py-2 text-right font-normal`}>Under</th>
              {graded ? <th className="px-4 py-2 text-right font-normal">Result</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {rows.map((r, i) => {
              const move = r[6] == null ? null : Math.round((r[3] - r[6]) * 10) / 10;
              const key = `${r[0]}-${r[2]}`;
              const ladder = r[7]?.length ? r[7] : null;
              const isOpen = ladder != null && openKey === key;
              return (
                <Fragment key={`${key}-${i}`}>
                  <tr className={`hover:bg-line/5 ${isOpen ? "bg-line/5" : ""}`}>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        {r[0]} <PropTeam league={league} abbr={r[1]} />
                        {ladder ? (
                          <button
                            type="button"
                            onClick={() => setOpenKey(isOpen ? null : key)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} alternate lines`}
                            title="Alternate lines"
                            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ring-1 ${
                              isOpen
                                ? "bg-acc/15 text-acc ring-acc/40"
                                : "text-mute ring-line/15 hover:text-acc"
                            }`}
                          >
                            {isOpen ? "▴" : "▾"}
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-mute">{r[2]}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {r[3]}
                    </td>
                    {hasOpen ? (
                      <>
                        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                          {r[6] ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <MovePill move={move} />
                        </td>
                      </>
                    ) : null}
                    <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                      {american(r[4])}
                    </td>
                    <td
                      className={`${graded ? "px-2" : "px-4"} py-2 text-right font-mono text-xs tabular-nums text-mute`}
                    >
                      {american(r[5])}
                    </td>
                    {graded ? (
                      <td className="px-4 py-2 text-right">
                        <Outcome line={r[3]} actual={results.get(`${r[0]}|${r[2]}`)} />
                      </td>
                    ) : null}
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={cols} className="px-0 pb-2 pt-0">
                        <PropLadder
                          line={r[3]}
                          over={r[4]}
                          ladder={ladder}
                          unit={r[2]}
                          width={wrapW}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={cols} className="px-4 py-6 text-center font-mono text-xs text-mute">
                  No props match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 font-mono text-[10px] text-faint">
        DraftKings via ESPN{game.at ? `, as of ${kickoff(game.at)}` : ""}
        {closing ? " (the last lines before kickoff)" : ""}.{" "}
        {hasOpen ? 'Move is the change since the line opened ("held" = no move). ' : ""}"—" for
        prices means no price was saved for that line.
        {graded
          ? ` Result: what the player did against the ${closing ? "closing" : "listed"} line; results fill in a few hours after the game.`
          : ""}
      </p>
    </Panel>
  );
}

/** A finished prop: the player's number and whether it went over or under the closing line. */
function Outcome({ line, actual }: { line: number; actual: number | null | "dnp" | undefined }) {
  if (actual === "dnp")
    return (
      <span
        className="inline-block w-14 rounded bg-panel2 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-faint ring-1 ring-line/10"
        title="Didn't play: the bet is void"
      >
        void
      </span>
    );
  if (actual == null) return <span className="font-mono text-[10px] text-faint">—</span>;
  const res = actual > line ? "over" : actual < line ? "under" : "push";
  const cls =
    res === "over"
      ? "bg-win/10 text-win ring-win/25"
      : res === "under"
        ? "bg-loss/10 text-loss ring-loss/25"
        : "bg-panel2 text-mute ring-line/10";
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="font-mono text-xs font-semibold tabular-nums">{actual}</span>
      <span
        className={`inline-block w-14 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider ring-1 ${cls}`}
      >
        {res}
      </span>
    </span>
  );
}

/** Overs vs unders among the props shown, against the closing line. */
function OverUnderCount({
  rows,
  results,
}: {
  rows: UpcomingPropGame["props"];
  results: Map<string, number | null | "dnp">;
}) {
  let over = 0;
  let under = 0;
  for (const r of rows) {
    const a = results.get(`${r[0]}|${r[2]}`);
    if (a == null || a === "dnp") continue;
    if (a > r[3]) over += 1;
    else if (a < r[3]) under += 1;
  }
  if (!over && !under) return null;
  return (
    <p className="px-4 pt-2 font-mono text-[11px] text-mute">
      <span className="text-win">{over} over</span> ·{" "}
      <span className="text-loss">{under} under</span> the line
    </p>
  );
}

/**
 * DraftKings' alternate over lines as a swipeable strip, like the sportsbook's: the main line in the
 * middle, safer lines (minus prices) to the left, longer shots (plus prices) to the right.
 */
function PropLadder({
  line,
  over,
  ladder,
  unit,
  width,
}: {
  line: number;
  over: number | null;
  ladder: [number, number][];
  unit: string;
  width?: number;
}) {
  const rungs = useMemo(() => {
    const all = ladder.map(([ln, o]) => ({ ln, o, main: false }));
    if (!all.some((x) => x.ln === line)) all.push({ ln: line, o: over ?? NaN, main: true });
    return all.sort((a, b) => a.ln - b.ln);
  }, [ladder, line, over]);
  const [sel, setSel] = useState(line);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const m = el?.querySelector<HTMLElement>("[data-main]");
    if (el && m) el.scrollLeft = m.offsetLeft - el.clientWidth / 2 + m.offsetWidth / 2;
  }, [width]);
  const picked = rungs.find((x) => x.ln === sel) ?? rungs[0];
  const imp = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
  const pr = Number.isFinite(picked.o) ? imp(picked.o) : null;
  const what = picked.main ? `Over ${picked.ln}` : `${Math.ceil(picked.ln)}+ ${unit.toLowerCase()}`;
  return (
    <div
      className="sticky left-0 border-y border-line/10 bg-panel2/40 py-2.5"
      style={width ? { width } : undefined}
    >
      <div className="flex justify-between px-4 pb-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">
        <span>◀ safer</span>
        <span>longer shot ▶</span>
      </div>
      <div
        ref={strip}
        className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-4 pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {rungs.map((x) => {
          const on = x.ln === sel;
          return (
            <button
              key={x.ln}
              type="button"
              data-main={x.main ? "" : undefined}
              onClick={() => setSel(x.ln)}
              aria-pressed={on}
              aria-label={`${x.main ? `Over ${x.ln}` : `${Math.ceil(x.ln)} or more`}, ${american(Number.isFinite(x.o) ? x.o : null)}`}
              className={`relative flex h-12 w-16 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-lg ring-1 transition-colors ${
                on
                  ? "bg-acc/15 ring-acc"
                  : x.main
                    ? "bg-panel ring-acc/60"
                    : "bg-panel ring-line/10 hover:ring-line/30"
              }`}
            >
              {x.main ? (
                <span className="absolute -top-2 rounded-full bg-acc px-1.5 py-px font-mono text-[8px] font-bold tracking-wider text-background">
                  LINE
                </span>
              ) : null}
              <span className="text-sm font-bold tabular-nums">
                {x.main ? x.ln : `${Math.ceil(x.ln)}+`}
              </span>
              <span
                className={`font-mono text-[11px] font-semibold tabular-nums ${x.o > 0 ? "text-win" : "text-mute"}`}
              >
                {Number.isFinite(x.o) ? american(x.o) : "—"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-4 pt-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line/10">
          <div
            className="h-1 rounded-full bg-acc"
            style={{ width: `${Math.round((pr ?? 0) * 100)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-foreground">
          {what} · {american(Number.isFinite(picked.o) ? picked.o : null)}
          {pr != null ? ` · ${Math.round(pr * 100)}% implied` : ""}
        </span>
      </div>
    </div>
  );
}

/** The player's team as a small logo (ESPN's CDN), falling back to the abbreviation. */
function PropTeam({ league, abbr }: { league: PropLeague; abbr: string }) {
  const [failed, setFailed] = useState(false);
  const nfl = league === "nfl" ? teamByAbbr(abbr) : undefined;
  if (nfl) return <TeamLogo team={nfl} className="size-4" />;
  if (failed || !abbr) return <span className="font-mono text-[10px] text-faint">{abbr}</span>;
  return (
    <img
      src={`https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`}
      alt={abbr}
      title={abbr}
      className="inline-block size-4 shrink-0 object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Line move since the open: a green ▲ / red ▼ pill sized by the move, a quiet "held" pill when flat. */
function MovePill({ move }: { move: number | null }) {
  if (move == null) return null;
  const base =
    "inline-flex min-w-[3.25rem] items-center justify-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ring-1";
  if (!move)
    return (
      <span
        className={`${base} bg-line/5 font-normal uppercase tracking-wider text-faint ring-line/10`}
      >
        held
      </span>
    );
  const up = move > 0;
  return (
    <span
      className={`${base} ${up ? "bg-win/10 text-win ring-win/25" : "bg-loss/10 text-loss ring-loss/25"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(move)} since it opened`}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(move)}
    </span>
  );
}

export function PropHistoryPage({ league }: { league: PropLeague }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const tabs = (
    <div className="mb-4 flex gap-2" role="tablist" aria-label="Prop lines">
      {(
        [
          ["upcoming", "Upcoming games"],
          ["past", "Past results"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={tab === k}
          onClick={() => setTab(k)}
          className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
            tab === k
              ? "bg-acc/10 text-acc ring-acc/25"
              : "bg-panel2 text-mute ring-line/10 hover:text-acc"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return tab === "upcoming" ? (
    <Upcoming league={league} tabs={tabs} />
  ) : (
    <PastResults league={league} tabs={tabs} />
  );
}
