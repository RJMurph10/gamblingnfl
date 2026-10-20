import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Panel, TeamLogo } from "@/components/booth";
import type { Game } from "@/data/games";
import type { Team } from "@/data/teams";
import { getGamePropPredictions, getPropPeople } from "@/lib/espn.functions";
import {
  PROP_CATEGORIES,
  RANGE_COVERAGE_TARGET,
  RANGE_METHOD_NOTE,
  formatProjection,
  isOffensivePosition,
  marketByKey,
  marketsForCategory,
  type PropCategory,
  type PropMarketDef,
} from "@/lib/prop-model";

/** One saved prediction joined to a real player in this game. */
interface ProjectionRow {
  id: string;
  playerId: string;
  name: string;
  position: string;
  teamAbbr: string;
  side: "away" | "home";
  market: PropMarketDef;
  projected: number;
  lower: number;
  upper: number;
  rangeMethod: string;
  modelVersion: string;
  createdAt: string;
  actual?: number | null;
  absError?: number | null;
  inRange?: boolean | null;
}

const POSITION_ORDER = ["QB", "RB", "FB", "WR", "TE"];

const kickoffText = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Kickoff time TBD";

function StatusBadge({ game }: { game: Game }) {
  const live = game.status === "live";
  const final = game.status === "final";
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
        live ? "bg-loss/15 text-loss" : final ? "bg-panel2 text-mute" : "bg-acc/10 text-acc"
      }`}
    >
      {live ? `Live${game.clock ? ` · ${game.clock}` : ""}` : final ? "Final" : "Upcoming"}
    </span>
  );
}

export function GamePropAnalysis({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const [category, setCategory] = useState<PropCategory>("passing");
  const [marketKey, setMarketKey] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<"all" | "away" | "home">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"projection" | "name">("projection");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Real players for both teams (the same ESPN rosters the rest of the site uses).
  const rosterQuery = useQuery({
    queryKey: ["prop-roster", away.abbr, home.abbr],
    queryFn: () => getPropPeople({ data: { awayAbbr: away.abbr, homeAbbr: home.abbr } }),
    staleTime: 10 * 60_000,
  });
  // Saved model projections for exactly this game; nothing is calculated in the browser.
  const predictionsQuery = useQuery({
    queryKey: ["prop-predictions", game.id],
    queryFn: () => getGamePropPredictions({ data: { gameId: game.id } }),
    refetchInterval: game.status === "live" ? 60_000 : 5 * 60_000,
    staleTime: 30_000,
  });

  const people = useMemo(() => {
    const map = new Map<string, { id: string; name: string; position: string; team: string; headshot?: string }>();
    for (const p of rosterQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [rosterQuery.data]);

  const sideOf = (abbr: string): "away" | "home" | undefined =>
    abbr === away.abbr ? "away" : abbr === home.abbr ? "home" : undefined;

  const offensivePlayers = useMemo(
    () =>
      [...people.values()]
        .filter((p) => isOffensivePosition(p.position) && sideOf(p.team))
        .sort(
          (a, b) =>
            Number(sideOf(a.team) === "home") - Number(sideOf(b.team) === "home") ||
            POSITION_ORDER.indexOf(a.position.toUpperCase()) - POSITION_ORDER.indexOf(b.position.toUpperCase()) ||
            a.name.localeCompare(b.name),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, away.abbr, home.abbr],
  );

  const predictions = predictionsQuery.data;
  const rows = useMemo<ProjectionRow[]>(() => {
    const out: ProjectionRow[] = [];
    for (const p of predictions?.predictions ?? []) {
      const market = marketByKey(p.stat);
      if (!market) continue;
      const person = people.get(p.playerId);
      const position = person?.position ?? p.position ?? "";
      if (!isOffensivePosition(position)) continue;
      const teamAbbr = person?.team || p.teamAbbr || "";
      const side = sideOf(teamAbbr);
      // Never show a player who is not on one of this game's two teams.
      if (!side) continue;
      out.push({
        id: p.id,
        playerId: p.playerId,
        name: person?.name ?? p.playerName ?? "Unknown player",
        position,
        teamAbbr,
        side,
        market,
        projected: p.projected,
        lower: p.lower,
        upper: p.upper,
        rangeMethod: p.rangeMethod,
        modelVersion: p.modelVersion,
        createdAt: p.createdAt,
        actual: p.actual,
        absError: p.absError,
        inRange: p.inRange,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictions, people, away.abbr, home.abbr]);

  const needle = search.trim().toLowerCase();
  const matchesFilters = (name: string, side: "away" | "home") =>
    (teamFilter === "all" || teamFilter === side) && (!needle || name.toLowerCase().includes(needle));

  const categoryRows = rows.filter((r) => r.market.category === category);
  const shownRows = categoryRows
    .filter((r) => (marketKey === "all" || r.market.key === marketKey) && matchesFilters(r.name, r.side))
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name) || a.market.label.localeCompare(b.market.label)
        : b.projected - a.projected || a.name.localeCompare(b.name),
    );

  const hasProjections = predictions?.status === "ready" && rows.length > 0;
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finalGame = game.status === "final";
  const inputClass =
    "rounded-md border border-line/10 bg-panel2/40 px-3 py-1.5 text-sm placeholder:text-faint focus:border-acc/40 focus:outline-none";

  return (
    <Panel padded={false}>
      {/* Matchup header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <TeamLogo team={away} className="size-10" />
          <div>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight sm:text-2xl">
              {away.name} <span className="text-mute">@</span> {home.name}
            </h2>
            <p suppressHydrationWarning className="font-mono text-[11px] uppercase tracking-wider text-mute">
              {kickoffText(game.kickoffIso)}
              {game.venue && game.venue !== "TBD" ? ` · ${game.venue}` : ""}
            </p>
          </div>
          <TeamLogo team={home} className="size-10" />
        </div>
        <StatusBadge game={game} />
      </div>

      {/* Status of the model for this game */}
      {!hasProjections ? (
        <div className="border-b border-line/10 bg-panel2/30 px-4 py-3 text-sm">
          {predictionsQuery.isLoading ? (
            <p className="text-mute">Loading projections for this game…</p>
          ) : (
            <>
              <p className="font-semibold">Model projections aren&apos;t available for this game yet.</p>
              <p className="mt-1 text-mute">
                {predictions?.message ??
                  "No projections have been saved for this matchup."}{" "}
                Real offensive players for both teams are listed below; projected stats and ranges will appear here
                once the model saves them before kickoff. Nothing on this page is estimated or made up.
              </p>
            </>
          )}
        </div>
      ) : null}

      {/* Controls */}
      <div className="space-y-3 px-4 py-3">
        {hasProjections ? (
          <>
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Prop category">
              {PROP_CATEGORIES.map((c) => {
                const count = rows.filter((r) => r.market.category === c.key).length;
                const active = c.key === category;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setCategory(c.key);
                      setMarketKey("all");
                    }}
                    className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-disp text-xs font-semibold uppercase tracking-wider ${
                      active ? "bg-acc text-black" : "bg-panel2 text-mute hover:text-foreground"
                    }`}
                  >
                    {c.label}
                    <span className={`ml-1.5 font-mono text-[10px] ${active ? "text-black/60" : "text-faint"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            {/* Supported vs not-yet-modeled markets in this category */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setMarketKey("all")}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                  marketKey === "all" ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"
                }`}
              >
                All
              </button>
              {marketsForCategory(category).map((market) => {
                const count = categoryRows.filter((r) => r.market.key === market.key).length;
                const active = marketKey === market.key;
                return (
                  <button
                    key={market.key}
                    type="button"
                    disabled={count === 0}
                    title={count === 0 ? "Not modeled for this game yet" : undefined}
                    onClick={() => setMarketKey(market.key)}
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                      active
                        ? "bg-acc/10 text-acc ring-acc/25"
                        : count === 0
                          ? "cursor-not-allowed bg-transparent text-faint ring-line/10 line-through decoration-faint/50"
                          : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                    }`}
                  >
                    {market.label}
                    {count === 0 ? " · not modeled" : ` · ${count}`}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search players in this game"
            aria-label="Search players in this game"
            className={`${inputClass} min-w-[180px] flex-1`}
          />
          <div className="flex gap-1" role="group" aria-label="Filter by team">
            {(
              [
                ["all", "Both"],
                ["away", away.abbr],
                ["home", home.abbr],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={teamFilter === key}
                onClick={() => setTeamFilter(key)}
                className={`rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  teamFilter === key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {hasProjections ? (
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as "projection" | "name")}
              aria-label="Sort"
              className={inputClass}
            >
              <option value="projection">Sort: projected stat</option>
              <option value="name">Sort: player A–Z</option>
            </select>
          ) : null}
        </div>
      </div>

      {/* Projection rows (real saved predictions only) */}
      {hasProjections ? (
        shownRows.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-xs text-mute">
            No {PROP_CATEGORIES.find((c) => c.key === category)?.label.toLowerCase()} projections match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Player</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 font-normal">Prop</th>
                  <th className="px-2 py-2 text-right font-normal">Projected</th>
                  <th className="px-2 py-2 text-right font-normal">Range</th>
                  <th className="px-4 py-2 text-right font-normal">{finalGame ? "Result" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {shownRows.map((row) => {
                  const open = expanded.has(row.id);
                  const evaluated = row.actual !== null && row.actual !== undefined;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => toggle(row.id)}
                        className="cursor-pointer hover:bg-line/5"
                        aria-expanded={open}
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            to="/players/$playerId"
                            params={{ playerId: row.playerId }}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium hover:text-acc"
                          >
                            {row.name}
                          </Link>
                          <span className="ml-2 font-mono text-[10px] text-faint">{row.position}</span>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-mute">{row.teamAbbr}</td>
                        <td className="px-2 py-2.5 text-mute">{row.market.label}</td>
                        <td className="px-2 py-2.5 text-right font-mono text-base font-bold tabular-nums text-acc">
                          {formatProjection(row.market.kind, row.projected)}
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                          <span className="rounded bg-panel2 px-2 py-0.5">
                            {row.lower}–{row.upper}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider">
                          {evaluated ? (
                            <span className={row.inRange ? "text-win" : "text-loss"}>
                              {row.actual} · {row.inRange ? "in range" : "outside"}
                            </span>
                          ) : (
                            <span className="text-faint">{finalGame ? "Pending" : "Locked pregame"}</span>
                          )}
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-panel2/30">
                          <td colSpan={6} className="px-4 py-3 text-xs text-mute">
                            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              <p>
                                <span className="text-faint">Projected range: </span>
                                {row.lower}–{row.upper} (likely outcomes, not a sportsbook line)
                              </p>
                              <p>
                                <span className="text-faint">Model: </span>
                                {row.modelVersion || "—"} · range rule {row.rangeMethod || "—"}
                              </p>
                              <p suppressHydrationWarning>
                                <span className="text-faint">Saved: </span>
                                {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                              </p>
                              <p>
                                <span className="text-faint">Result: </span>
                                {evaluated
                                  ? `${row.actual} actual · error ${row.absError?.toFixed(1) ?? "—"} · ${
                                      row.inRange ? "inside" : "outside"
                                    } the range`
                                  : finalGame
                                    ? "Waiting for final player stats"
                                    : "Available after the game"}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : rosterQuery.isLoading ? (
        <p className="px-4 pb-6 text-center font-mono text-xs text-mute">Loading players…</p>
      ) : (
        <PlayerList
          players={offensivePlayers.filter((p) => matchesFilters(p.name, sideOf(p.team)!))}
          away={away}
          home={home}
          loadFailed={rosterQuery.isError || offensivePlayers.length === 0}
        />
      )}

      <p className="border-t border-line/10 px-4 py-3 text-[11px] text-faint">
        Ranges follow one fixed rule per statistic ({RANGE_METHOD_NOTE}) The goal is for about{" "}
        {Math.round(RANGE_COVERAGE_TARGET * 100)}% of actual results to land inside the range.
      </p>
    </Panel>
  );
}

/** Real offensive players, shown while projections are not available. */
function PlayerList({
  players,
  away,
  home,
  loadFailed,
}: {
  players: { id: string; name: string; position: string; team: string }[];
  away: Team;
  home: Team;
  loadFailed: boolean;
}) {
  if (players.length === 0) {
    return (
      <p className="px-4 pb-6 text-center font-mono text-xs text-mute">
        {loadFailed ? "The player list for these teams couldn't be loaded." : "No players match these filters."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Player</th>
            <th className="px-2 py-2 font-normal">Team</th>
            <th className="px-2 py-2 font-normal">Pos</th>
            <th className="px-4 py-2 text-right font-normal">Projections</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {players.map((player) => (
            <tr key={player.id} className="hover:bg-line/5">
              <td className="px-4 py-2.5">
                <Link to="/players/$playerId" params={{ playerId: player.id }} className="font-medium hover:text-acc">
                  {player.name}
                </Link>
              </td>
              <td className="px-2 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-mono text-mute">
                  <TeamLogo team={player.team === away.abbr ? away : home} className="size-4" />
                  {player.team}
                </span>
              </td>
              <td className="px-2 py-2.5 font-mono text-mute">{player.position}</td>
              <td className="px-4 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider text-faint">
                Awaiting model
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
