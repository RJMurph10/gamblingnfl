/**
 * "Prop history": every player prop line the sportsbooks posted for past games (main line, opening
 * prices) next to what the player actually did. NBA from 2022-23, NFL from 2024 (2022-23 has mostly
 * touchdown props), refreshed daily during the season.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { getPropHistory, getUpcomingProps } from "@/lib/shared/prop-history.functions";
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

function result(r: PropHistoryRow): "over" | "under" | "push" | null {
  const [, , , line, , , actual] = r;
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
  selected,
  onSelect,
}: {
  game: PropHistoryGame;
  selected: boolean;
  onSelect: () => void;
}) {
  const aw = (game.away.score ?? 0) > (game.home.score ?? 0);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`shrink-0 rounded-lg px-3 py-2 text-left font-mono text-xs ring-1 transition ${
        selected
          ? "bg-acc/10 text-acc ring-acc/30"
          : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
      }`}
    >
      <span className={aw ? "font-semibold text-foreground" : ""}>
        {game.away.abbr} {game.away.score ?? ""}
      </span>
      <span className="mx-1 text-faint">@</span>
      <span className={!aw ? "font-semibold text-foreground" : ""}>
        {game.home.abbr} {game.home.score ?? ""}
      </span>
      <span className="ml-2 text-[10px] text-faint">{game.props.length} props</span>
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
    const graded = all.filter((r) => result(r) && result(r) !== "push");
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
        the player actually did. {COVERAGE[league]} This season updates four times a day, so finished games show up the same night.
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
                      {r[0]} <span className="font-mono text-[10px] text-faint">{r[1]}</span>
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

function Upcoming({ league, tabs }: { league: PropLeague; tabs: ReactNode }) {
  const [gameId, setGameId] = useState<string | undefined>();
  const [market, setMarket] = useState("All");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["upcoming-props", league],
    queryFn: () => getUpcomingProps({ data: { league } }),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const games: UpcomingPropGame[] = useMemo(() => q.data ?? [], [q.data]);
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
              onClick={() => {
                setGameId(g.id);
                setMarket("All");
              }}
              className={`shrink-0 rounded-lg px-3 py-2 text-left font-mono text-xs ring-1 transition ${
                g.id === game?.id
                  ? "bg-acc/10 text-acc ring-acc/30"
                  : "bg-panel2/40 text-mute ring-line/10 hover:text-acc"
              }`}
            >
              <span className="font-semibold text-foreground">
                {g.away.abbr} @ {g.home.abbr}
              </span>
              <span className="ml-2 text-[10px] text-faint" suppressHydrationWarning>
                {kickoff(g.date)} · {g.props.length} props
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
      {game ? (
        <Panel padded={false}>
          <PanelHeader
            title={`${game.away.name} @ ${game.home.name}`}
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
                  <th className="px-2 py-2 text-right font-normal">Opened</th>
                  <th className="px-2 py-2 text-right font-normal">Move</th>
                  <th className="px-2 py-2 text-right font-normal">Over</th>
                  <th className="px-4 py-2 text-right font-normal">Under</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {rows.map((r, i) => {
                  const move = r[6] == null ? null : Math.round((r[3] - r[6]) * 10) / 10;
                  return (
                    <tr key={`${r[0]}-${r[2]}-${i}`} className="hover:bg-line/5">
                      <td className="px-4 py-2">
                        {r[0]} <span className="font-mono text-[10px] text-faint">{r[1]}</span>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-mute">{r[2]}</td>
                      <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                        {r[3]}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                        {r[6] ?? "—"}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
                          move ? (move > 0 ? "text-win" : "text-loss") : "text-faint"
                        }`}
                      >
                        {move ? `${move > 0 ? "▲" : "▼"} ${Math.abs(move)}` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums text-mute">
                        {american(r[4])}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-mute">
                        {american(r[5])}
                      </td>
                    </tr>
                  );
                })}
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
            DraftKings via ESPN{game.at ? `, as of ${kickoff(game.at)}` : ""}. "—" for prices means
            the line is posted without a price in the feed.
          </p>
        </Panel>
      ) : null}
    </>
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
