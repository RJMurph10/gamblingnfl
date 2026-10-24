import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Panel, TeamLogo } from "@/components/booth";
import type { Game } from "@/data/games";
import type { Team } from "@/data/teams";
import {
  gameRoute,
  playerRoute,
  teamKey,
  teamRoute,
  teamShort,
  useLeague,
} from "@/lib/league-links";
import {
  getGamePropAnalytics,
  getGamePropPredictions,
  getGamePropProjections,
  getPropAvailability,
  getPropPeople,
} from "@/lib/espn.functions";
import {
  STARTER_SLOTS,
  availabilityOf,
  availabilityTag,
  isRuledOut,
  selectStarters,
  type Availability,
  type LineupCandidate,
} from "@/lib/prop-lineup";
import type { PlayerStatModel, PlayerUsage } from "@/lib/player-projection-model";
import {
  analyticsRowsForCategory,
  trendOf,
  type MarketSummary,
  type PlayerPropAnalytics,
} from "@/lib/prop-analytics";
import {
  PROP_CATEGORIES,
  PROP_MARKETS,
  RANGE_COVERAGE_TARGET,
  RANGE_METHOD_NOTE,
  formatProjection,
  isMarketForPosition,
  isPropPlayerPosition,
  marketByKey,
  marketsForCategory,
  normalizePropPosition,
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

const POSITION_ORDER = ["QB", "RB", "FB", "WR", "TE", "K", "P"];

const marketOrder = (key: string) => PROP_MARKETS.findIndex((m) => m.key === key);

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

/** Team logo that opens the team's page. */
export function TeamLink({ team, className = "size-5" }: { team: Team; className?: string }) {
  return (
    <Link
      to={teamRoute(team.id)}
      params={{ teamId: team.id }}
      onClick={(event) => event.stopPropagation()}
      aria-label={`${team.city} ${team.name} team page`}
      title={`${team.city} ${team.name}`}
      className="inline-flex shrink-0 rounded-sm outline-none ring-acc/40 transition-transform hover:scale-110 focus-visible:ring-2"
    >
      <TeamLogo team={team} className={className} />
    </Link>
  );
}

function StatusBadge({ game }: { game: Game }) {
  const live = game.status === "live";
  const final = game.status === "final";
  if (live)
    // Live games: green, and a link to the game's live page.
    return (
      <Link
        to={gameRoute(game.id)}
        params={{ gameId: game.id }}
        title="Open the live game"
        className="inline-flex items-center gap-1.5 rounded bg-win/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-win transition-colors hover:bg-win/25"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-win" aria-hidden />
        Live{game.clock ? ` · ${game.clock}` : ""}
        <span aria-hidden>→</span>
      </Link>
    );
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
  const league = useLeague();
  // The server looks teams up by these keys (NFL abbreviations, college team ids); players come
  // back tagged with them, and abbrOf turns one back into the abbreviation shown.
  const awayKey = teamKey(away);
  const homeKey = teamKey(home);
  const abbrOf = (key: string) => (key === awayKey ? away.abbr : key === homeKey ? home.abbr : key);
  const [category, setCategory] = useState<PropCategory>("passing");
  const [marketKey, setMarketKey] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<"all" | "away" | "home">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"model" | "value" | "recent" | "name">("model");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Sportsbook-style board: projected starters only, with ruled-out players hidden.
  const [lineup, setLineup] = useState<"starters" | "all">("starters");
  const [showOut, setShowOut] = useState(false);

  // Real players for both teams (the same ESPN rosters the rest of the site uses).
  const rosterQuery = useQuery({
    queryKey: ["prop-roster", awayKey, homeKey],
    queryFn: () => getPropPeople({ data: { awayAbbr: awayKey, homeAbbr: homeKey } }),
    staleTime: 10 * 60_000,
  });
  // Saved model projections for exactly this game; nothing is calculated in the browser.
  const predictionsQuery = useQuery({
    queryKey: ["prop-predictions", game.id],
    queryFn: () => getGamePropPredictions({ data: { gameId: game.id } }),
    refetchInterval: game.status === "live" ? 60_000 : 5 * 60_000,
    staleTime: 30_000,
  });

  // Real results from completed games for both teams (season averages, last 3, highs/lows).
  const analyticsQuery = useQuery({
    queryKey: ["prop-analytics", awayKey, homeKey],
    queryFn: () => getGamePropAnalytics({ data: { awayAbbr: awayKey, homeAbbr: homeKey } }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  // Model projections for every prop in this game, with the model's season accuracy.
  const projectionsQuery = useQuery({
    queryKey: ["prop-projections", game.id, awayKey, homeKey],
    queryFn: () =>
      getGamePropProjections({
        data: { eventId: game.id, awayAbbr: awayKey, homeAbbr: homeKey },
      }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const usageFor = (playerId: string): PlayerUsage | undefined =>
    projectionsQuery.data?.usage?.[playerId];
  const modelFor = (playerId: string, key: string): PlayerStatModel | undefined =>
    projectionsQuery.data?.players[playerId]?.[key];
  const analyticsPlayers = useMemo(() => analyticsQuery.data?.players ?? [], [analyticsQuery.data]);
  const analyticsById = useMemo(() => {
    const map = new Map<string, PlayerPropAnalytics>();
    for (const p of analyticsPlayers) map.set(p.id, p);
    return map;
  }, [analyticsPlayers]);

  // Injury report + depth chart for this game.
  const availabilityQuery = useQuery({
    queryKey: ["prop-availability", game.id, awayKey, homeKey],
    queryFn: () =>
      getPropAvailability({ data: { eventId: game.id, awayAbbr: awayKey, homeAbbr: homeKey } }),
    staleTime: 5 * 60_000,
    refetchInterval: game.status === "final" ? false : 10 * 60_000,
    retry: 1,
  });
  const availabilityById = useMemo(() => {
    const map = new Map<string, { status?: string; detail?: string; depthRank?: number }>();
    for (const p of availabilityQuery.data?.players ?? [])
      map.set(p.id, { status: p.injuryStatus, detail: p.injuryDetail, depthRank: p.depthRank });
    return map;
  }, [availabilityQuery.data]);
  const availabilityFor = (id: string): Availability =>
    availabilityOf(availabilityById.get(id)?.status);

  const people = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; position: string; team: string; headshot?: string }
    >();
    for (const p of rosterQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [rosterQuery.data]);

  const sideOf = (abbr: string): "away" | "home" | undefined =>
    abbr === awayKey ? "away" : abbr === homeKey ? "home" : undefined;

  const offensivePlayers = useMemo(
    () =>
      [...people.values()]
        .filter((p) => isPropPlayerPosition(p.position) && sideOf(p.team))
        .sort(
          (a, b) =>
            Number(sideOf(a.team) === "home") - Number(sideOf(b.team) === "home") ||
            POSITION_ORDER.indexOf(normalizePropPosition(a.position)) -
              POSITION_ORDER.indexOf(normalizePropPosition(b.position)) ||
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
      const position = normalizePropPosition(person?.position ?? p.position ?? "");
      if (!isPropPlayerPosition(position)) continue;
      // Same position rules as the analytics: e.g. passing props are for quarterbacks only.
      if (!isMarketForPosition(market.key, position)) continue;
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

  // Projected starters per team: depth chart order (then recent workload), skipping anyone ruled out.
  const { starters, healthyStarters } = useMemo(() => {
    const usageOf = (id: string) => {
      const m = analyticsById.get(id)?.markets ?? {};
      const l3 = (key: string) => m[key]?.last3 ?? 0;
      return (
        l3("pass_att") +
        l3("rush_att") +
        l3("targets") +
        l3("fg_made") +
        l3("xp_made") +
        l3("punts")
      );
    };
    const candidates: LineupCandidate[] = [];
    const seen = new Set<string>();
    const add = (id: string, teamAbbr: string, position: string) => {
      if (seen.has(id) || !isPropPlayerPosition(position) || !sideOf(teamAbbr)) return;
      seen.add(id);
      const a = availabilityById.get(id);
      candidates.push({
        id,
        teamAbbr,
        position,
        depthRank: a?.depthRank,
        injuryStatus: a?.status,
        usage: usageOf(id),
      });
    };
    for (const p of people.values()) add(p.id, p.team, p.position);
    for (const p of analyticsPlayers) add(p.id, p.teamAbbr, p.position);
    return {
      starters: selectStarters(candidates),
      // Who would start if everyone were healthy, so "show injured" can bring back ruled-out starters.
      healthyStarters: selectStarters(candidates.map((c) => ({ ...c, injuryStatus: undefined }))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, analyticsPlayers, analyticsById, availabilityById, away.abbr, home.abbr]);
  const lineupKnown = starters.size > 0;
  const isListed = (id: string) => {
    const out = isRuledOut(availabilityFor(id));
    if (out && !showOut) return false;
    if (lineup === "all" || !lineupKnown) return true;
    return starters.has(id) || (showOut && out && healthyStarters.has(id));
  };
  const injuryTagFor = (id: string) => {
    const a = availabilityById.get(id);
    const tag = availabilityTag(availabilityOf(a?.status));
    return tag ? { tag, status: a?.status ?? "", detail: a?.detail, out: tag !== "Q" } : undefined;
  };
  const hiddenOut = useMemo(
    () =>
      [...availabilityById.entries()].filter(
        ([id, a]) =>
          isRuledOut(availabilityOf(a.status)) &&
          (people.get(id) ? isPropPlayerPosition(people.get(id)!.position) : false),
      ).length,
    [availabilityById, people],
  );

  const needle = search.trim().toLowerCase();
  const matchesFilters = (name: string, side: "away" | "home", id?: string) =>
    (teamFilter === "all" || teamFilter === side) &&
    (!needle || name.toLowerCase().includes(needle)) &&
    (!id || isListed(id));

  const categoryRows = rows.filter((r) => r.market.category === category);
  const shownRows = categoryRows
    .filter(
      (r) =>
        (marketKey === "all" || r.market.key === marketKey) &&
        matchesFilters(r.name, r.side, r.playerId),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name) || a.market.label.localeCompare(b.market.label)
        : b.projected - a.projected || a.name.localeCompare(b.name),
    );

  const hasProjections = predictions?.status === "ready" && rows.length > 0;
  const hasAnalytics = !hasProjections && analyticsPlayers.length > 0;
  const showTabs = hasProjections || hasAnalytics;

  const sideOfAbbr = (abbr: string) => sideOf(abbr) ?? "away";
  const categoryAnalytics = useMemo(
    () => analyticsRowsForCategory(analyticsPlayers, category),
    [analyticsPlayers, category],
  );
  const shownAnalytics = categoryAnalytics
    .filter(
      (r) =>
        (marketKey === "all" || r.summary.key === marketKey) &&
        matchesFilters(r.player.name, sideOfAbbr(r.player.teamAbbr), r.player.id),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.player.name.localeCompare(b.player.name) ||
          marketOrder(a.summary.key) - marketOrder(b.summary.key)
        : // Different props have different units, so group by prop before ranking players.
          marketOrder(a.summary.key) - marketOrder(b.summary.key) ||
          (sort === "model"
            ? (modelFor(b.player.id, b.summary.key)?.projection?.projected ?? -1) -
                (modelFor(a.player.id, a.summary.key)?.projection?.projected ?? -1) ||
              b.summary.avg - a.summary.avg ||
              a.player.name.localeCompare(b.player.name)
            : sort === "recent"
              ? b.summary.last3 - a.summary.last3 || a.player.name.localeCompare(b.player.name)
              : b.summary.avg - a.summary.avg || a.player.name.localeCompare(b.player.name)),
    );
  const countFor = (cat: PropCategory) =>
    hasProjections
      ? rows.filter((r) => r.market.category === cat && isListed(r.playerId)).length
      : analyticsRowsForCategory(analyticsPlayers, cat).filter((r) => isListed(r.player.id)).length;
  const marketCount = (key: string) =>
    hasProjections
      ? categoryRows.filter((r) => r.market.key === key && isListed(r.playerId)).length
      : categoryAnalytics.filter((r) => r.summary.key === key && isListed(r.player.id)).length;
  const scanned = analyticsQuery.data?.gamesScanned ?? {};
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
          <TeamLink team={away} className="size-10" />
          <div>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight sm:text-2xl">
              {teamShort(away)} <span className="text-mute">@</span> {teamShort(home)}
            </h2>
            <p
              suppressHydrationWarning
              className="font-mono text-[11px] uppercase tracking-wider text-mute"
            >
              {kickoffText(game.kickoffIso)}
              {game.venue && game.venue !== "TBD" ? ` · ${game.venue}` : ""}
            </p>
          </div>
          <TeamLink team={home} className="size-10" />
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
              <p className="font-semibold">
                {hasAnalytics
                  ? "Player projections · model + 2026 results"
                  : "Model projections aren\u2019t available for this game yet."}
              </p>
              <p className="mt-1 text-mute">
                {hasAnalytics ? (
                  <>
                    {league === "cfb"
                      ? "The model projects each stat from recent form and this opponent\u2019s defense"
                      : "The model projects each stat from recent form, this opponent\u2019s defense and the expected game script"}
                    , using only games before this one ({away.abbr} {scanned[awayKey] ?? 0} games,{" "}
                    {home.abbr} {scanned[homeKey] ?? 0} games played).{" "}
                    {projectionsQuery.isLoading ? (
                      "Loading projections\u2026"
                    ) : projectionsQuery.data?.accuracy.overall.n ? (
                      <span className="text-foreground">
                        Season accuracy on these players:{" "}
                        {projectionsQuery.data.accuracy.overall.inRangePct}% of results inside the
                        range ({projectionsQuery.data.accuracy.overall.n} tested); results beat the
                        projection {projectionsQuery.data.accuracy.overall.overPct}% of the time.
                      </span>
                    ) : projectionsQuery.isError ? (
                      "Projections couldn\u2019t be loaded right now; season results are shown."
                    ) : null}
                  </>
                ) : analyticsQuery.isLoading ? (
                  "Loading player analytics from this season\u2019s box scores\u2026"
                ) : (
                  <>
                    {predictions?.message ?? "No projections have been saved for this matchup."}{" "}
                    Real players for both teams (offense, kickers and punters) are listed below.
                    Nothing on this page is estimated or made up.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      ) : null}

      {/* Controls */}
      <div className="space-y-3 px-4 py-3">
        {showTabs ? (
          <>
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Prop category">
              {PROP_CATEGORIES.map((c) => {
                const count = countFor(c.key);
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
                    <span
                      className={`ml-1.5 font-mono text-[10px] ${active ? "text-black/60" : "text-faint"}`}
                    >
                      {count}
                    </span>
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
                  marketKey === "all"
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10"
                }`}
              >
                All
              </button>
              {marketsForCategory(category).map((market) => {
                const count = marketCount(market.key);
                const active = marketKey === market.key;
                const emptyLabel = hasProjections ? "not modeled" : "no data";
                return (
                  <button
                    key={market.key}
                    type="button"
                    disabled={count === 0}
                    title={
                      count === 0
                        ? hasProjections
                          ? "Not modeled for this game yet"
                          : "No player has this stat yet"
                        : undefined
                    }
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
                    {count === 0 ? ` · ${emptyLabel}` : ` · ${count}`}
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
                  teamFilter === key
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {showTabs ? (
            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as "model" | "value" | "recent" | "name")
              }
              aria-label="Sort"
              className={inputClass}
            >
              {hasAnalytics ? <option value="model">Sort: model projection</option> : null}
              <option value="value">
                {hasProjections ? "Sort: projected stat" : "Sort: season average"}
              </option>
              {hasAnalytics ? <option value="recent">Sort: last 3 games</option> : null}
              <option value="name">Sort: player A–Z</option>
            </select>
          ) : null}
        </div>

        {/* Sportsbook-style lineup filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Which players to list">
            {(
              [
                ["starters", "Starters"],
                ["all", "All players"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={lineup === key}
                onClick={() => setLineup(key)}
                className={`rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                  lineup === key
                    ? "bg-acc/10 text-acc ring-acc/25"
                    : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showOut}
            onClick={() => setShowOut((v) => !v)}
            className={`rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ring-1 ${
              showOut
                ? "bg-loss/10 text-loss ring-loss/25"
                : "bg-panel2 text-mute ring-line/10 hover:text-acc"
            }`}
          >
            {showOut ? "Showing ruled out" : "Show ruled out"}
            {hiddenOut ? <span className="ml-1.5 text-faint">{hiddenOut}</span> : null}
          </button>
          <p className="text-[11px] text-faint">
            {lineup === "starters" && lineupKnown
              ? `Per team: ${Object.entries(STARTER_SLOTS)
                  .filter(([, n]) => n > 0)
                  .map(([pos, n]) => (n > 1 ? `${n} ${pos}` : pos))
                  .join(" · ")}. `
              : ""}
            {availabilityQuery.isLoading
              ? "Loading injury report…"
              : availabilityQuery.data
                ? `${availabilityQuery.data.sources.depthChart ? "ESPN depth chart" : "Recent usage (no depth chart)"}${
                    availabilityQuery.data.sources.injuryReport
                      ? " + injury report"
                      : " · no injury report posted"
                  }. Out, Doubtful and IR players are hidden unless shown.`
                : "Injury report unavailable — nobody is hidden for injury."}
          </p>
        </div>
      </div>

      {/* Projection rows (real saved predictions only) */}
      {hasProjections ? (
        shownRows.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-xs text-mute">
            No {PROP_CATEGORIES.find((c) => c.key === category)?.label.toLowerCase()} projections
            match these filters.
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
                  <th className="px-4 py-2 text-right font-normal">
                    {finalGame ? "Result" : "Status"}
                  </th>
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
                            to={playerRoute(league)}
                            params={{ playerId: row.playerId }}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium hover:text-acc"
                          >
                            {row.name}
                          </Link>
                          <span className="ml-2 font-mono text-[10px] text-faint">
                            {row.position}
                          </span>
                          <InjuryTag info={injuryTagFor(row.playerId)} />
                        </td>
                        <td className="px-2 py-2.5 font-mono text-mute">{abbrOf(row.teamAbbr)}</td>
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
                            <span className="text-faint">
                              {finalGame ? "Pending" : "Locked pregame"}
                            </span>
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
                              <AnalyticsLine
                                summary={analyticsById.get(row.playerId)?.markets[row.market.key]}
                              />
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
      ) : hasAnalytics ? (
        <AnalyticsTable
          abbrOf={abbrOf}
          tagFor={injuryTagFor}
          modelFor={modelFor}
          usageFor={usageFor}
          resultWeek={finalGame ? game.week : undefined}
          modelLoading={projectionsQuery.isLoading}
          rows={shownAnalytics}
          categoryLabel={PROP_CATEGORIES.find((c) => c.key === category)?.label ?? ""}
          expanded={expanded}
          toggle={toggle}
        />
      ) : rosterQuery.isLoading || analyticsQuery.isLoading ? (
        <p className="px-4 pb-6 text-center font-mono text-xs text-mute">Loading players…</p>
      ) : (
        <PlayerList
          players={offensivePlayers.filter((p) => matchesFilters(p.name, sideOf(p.team)!, p.id))}
          tagFor={injuryTagFor}
          away={away}
          home={home}
          loadFailed={rosterQuery.isError || offensivePlayers.length === 0}
        />
      )}

      <p className="border-t border-line/10 px-4 py-3 text-[11px] text-faint">
        {hasAnalytics ? (
          <>
            {league === "cfb" ? (
              <>
                Proj = model projection = the middle outcome from recent form (each player&apos;s
                last 8 games, latest weighted most, pulled back toward normal) × a partial
                adjustment for the opponent&apos;s defense. Range: where about 80% of results landed
                when tested on 2025 games (passing TDs: a count range). Season figures come from
                ESPN box scores of completed 2026 games. Not sportsbook lines or advice.
              </>
            ) : (
              <>
                Proj = model projection = recent form (latest games weighted most, pulled toward the
                position average early in the season) × opponent defense vs. that position ×
                expected game script. Range: {RANGE_METHOD_NOTE} Season figures come from ESPN box
                scores of completed 2026 games; longest-play stats only count games with such a
                play. Not sportsbook lines or advice.
              </>
            )}
          </>
        ) : (
          <>
            Ranges follow one fixed rule per statistic ({RANGE_METHOD_NOTE}) The goal is for about{" "}
            {Math.round(RANGE_COVERAGE_TARGET * 100)}% of actual results to land inside the range.
          </>
        )}
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
  tagFor,
}: {
  players: { id: string; name: string; position: string; team: string }[];
  tagFor: (id: string) => InjuryTagInfo | undefined;
  away: Team;
  home: Team;
  loadFailed: boolean;
}) {
  const league = useLeague();
  const awayKey = teamKey(away);
  const abbrOf = (key: string) =>
    key === awayKey ? away.abbr : key === teamKey(home) ? home.abbr : key;
  if (players.length === 0) {
    return (
      <p className="px-4 pb-6 text-center font-mono text-xs text-mute">
        {loadFailed
          ? "The player list for these teams couldn't be loaded."
          : "No players match these filters."}
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
                <Link
                  to={playerRoute(league)}
                  params={{ playerId: player.id }}
                  className="font-medium hover:text-acc"
                >
                  {player.name}
                </Link>
                <InjuryTag info={tagFor(player.id)} />
              </td>
              <td className="px-2 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-mono text-mute">
                  <TeamLink team={player.team === awayKey ? away : home} className="size-4" />
                  {abbrOf(player.team)}
                </span>
              </td>
              <td className="px-2 py-2.5 font-mono text-mute">
                {normalizePropPosition(player.position)}
              </td>
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

/* ---------- analytics (real results from completed games) ---------- */

const statText = (key: string, value: number) => {
  const market = marketByKey(key);
  if (!market) return String(value);
  return market.kind === "yards" || market.kind === "long"
    ? String(Math.round(value))
    : value.toFixed(1);
};

const wholeText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function TrendMark({ summary }: { summary: MarketSummary }) {
  const trend = trendOf(summary);
  if (trend === "flat") return null;
  return (
    <span
      className={`ml-1 text-[10px] ${trend === "up" ? "text-win" : "text-loss"}`}
      title={
        trend === "up"
          ? "Last 3 games well above season average"
          : "Last 3 games well below season average"
      }
      aria-label={trend === "up" ? "trending up" : "trending down"}
    >
      {trend === "up" ? "▲" : "▼"}
    </span>
  );
}

/** One-line season context shown inside an expanded projection row. */
function AnalyticsLine({ summary }: { summary?: MarketSummary }) {
  if (!summary) return null;
  return (
    <p>
      <span className="text-faint">This season: </span>
      {statText(summary.key, summary.avg)} avg · {statText(summary.key, summary.last3)} last 3 ·
      high {wholeText(summary.high)} · {summary.games} games
    </p>
  );
}

/** Week-by-week bars for one market, oldest game first. */
function GameLogBars({ summary }: { summary: MarketSummary }) {
  const max = Math.max(summary.high, 1);
  return (
    <div
      className="flex items-end gap-1.5 overflow-x-auto pb-1"
      role="img"
      aria-label="Game-by-game results"
    >
      {summary.log.map((g) => {
        const pct = Math.max(4, Math.round((g.value / max) * 100));
        const above = g.value >= summary.avg;
        return (
          <div
            key={`${g.week}-${g.opponent}`}
            className="flex w-10 shrink-0 flex-col items-center gap-1"
          >
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {wholeText(g.value)}
            </span>
            <div className="flex h-16 w-full items-end rounded-sm bg-panel2/60">
              <div
                className={`w-full rounded-sm ${above ? "bg-acc/70" : "bg-line/25"}`}
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[9px] uppercase text-faint">W{g.week}</span>
            <span className="font-mono text-[9px] uppercase text-mute">
              {g.home ? "" : "@"}
              {g.opponent}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AnalyticsTable({
  rows,
  categoryLabel,
  expanded,
  toggle,
  tagFor,
  modelFor,
  resultWeek,
  modelLoading,
  usageFor,
  abbrOf,
}: {
  /** Team key (abbreviation or college id) → abbreviation shown. */
  abbrOf: (key: string) => string;
  usageFor: (playerId: string) => PlayerUsage | undefined;
  tagFor: (id: string) => InjuryTagInfo | undefined;
  modelFor: (playerId: string, key: string) => PlayerStatModel | undefined;
  /** Week of this game when it's final, to show the actual result next to the projection. */
  resultWeek?: number;
  modelLoading: boolean;
  rows: { player: PlayerPropAnalytics; summary: MarketSummary }[];
  categoryLabel: string;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const league = useLeague();
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center font-mono text-xs text-mute">
        No {categoryLabel.toLowerCase()} stats match these filters.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Player</th>
            <th className="px-2 py-2 font-normal">Team</th>
            <th className="px-2 py-2 font-normal">Prop</th>
            <th className="px-2 py-2 text-right font-normal" title="Model projection for this game">
              Proj
            </th>
            <th
              className="px-2 py-2 text-right font-normal"
              title="Projected range of likely outcomes"
            >
              Range
            </th>
            {resultWeek !== undefined ? (
              <th
                className="px-2 py-2 text-right font-normal"
                title="What actually happened in this game"
              >
                Actual
              </th>
            ) : null}
            <th className="px-2 py-2 text-right font-normal" title="Season per-game average">
              Avg
            </th>
            <th
              className="px-2 py-2 text-right font-normal"
              title="Average of the last three games"
            >
              Last 3
            </th>
            <th className="px-2 py-2 text-right font-normal" title="Season low – high">
              Low–High
            </th>
            <th
              className="px-4 py-2 text-right font-normal"
              title="Model's hits inside its range on this player's earlier games"
            >
              Model hits
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {rows.map(({ player, summary }) => {
            const id = `a-${player.id}-${summary.key}`;
            const open = expanded.has(id);
            const market = marketByKey(summary.key);
            const kicking = market?.category === "kicking" ? player.kicking : undefined;
            const model = modelFor(player.id, summary.key);
            const proj = model?.projection;
            const actual =
              resultWeek !== undefined
                ? summary.log.find((g) => g.week === resultWeek)?.value
                : undefined;
            const columns = resultWeek !== undefined ? 10 : 9;
            return (
              <Fragment key={id}>
                <tr
                  onClick={() => toggle(id)}
                  className="cursor-pointer hover:bg-line/5"
                  aria-expanded={open}
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={playerRoute(league)}
                      params={{ playerId: player.id }}
                      onClick={(event) => event.stopPropagation()}
                      className="font-medium hover:text-acc"
                    >
                      {player.name}
                    </Link>
                    <span className="ml-2 font-mono text-[10px] text-faint">{player.position}</span>
                    <InjuryTag info={tagFor(player.id)} />
                    {usageFor(player.id)?.role === "backup" ? (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-mute ring-1 ring-line/20"
                        title={`Backup: plays only if ${usageFor(player.id)?.starterName ?? "the starter"} can't`}
                      >
                        Backup
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-mute">{abbrOf(player.teamAbbr)}</td>
                  <td className="px-2 py-2.5 text-mute">{market?.label ?? summary.key}</td>
                  <td
                    className={`px-2 py-2.5 text-right font-mono text-base font-bold tabular-nums ${
                      proj?.role === "backup" ? "text-faint" : "text-acc"
                    }`}
                  >
                    {proj ? statText(summary.key, proj.projected) : modelLoading ? "…" : "—"}
                    {proj && (proj.opportunity ?? 1) > 1 ? (
                      <span
                        className="ml-1 align-top text-[10px] text-win"
                        title={`Teammate ruled out: about ${Math.round(((proj.opportunity ?? 1) - 1) * 100)}% more opportunity`}
                        aria-label="Boosted by a teammate being out"
                      >
                        ▲
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                    {proj ? (
                      <span className="rounded bg-panel2 px-2 py-0.5">
                        {proj.lower}–{proj.upper}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {resultWeek !== undefined ? (
                    <td
                      className={`px-2 py-2.5 text-right font-mono tabular-nums ${
                        actual === undefined || !proj
                          ? "text-mute"
                          : actual >= proj.lower && actual <= proj.upper
                            ? "text-win"
                            : "text-loss"
                      }`}
                    >
                      {actual === undefined ? "—" : wholeText(actual)}
                    </td>
                  ) : null}
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                    {statText(summary.key, summary.avg)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                    {statText(summary.key, summary.last3)}
                    <TrendMark summary={summary} />
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                    {wholeText(summary.low)}–{wholeText(summary.high)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-faint">
                    {model && model.history.length
                      ? `${model.history.filter((h) => h.actual >= h.lower && h.actual <= h.upper).length}/${model.history.length}`
                      : "—"}
                  </td>
                </tr>
                {open ? (
                  <tr className="bg-panel2/30">
                    <td colSpan={columns} className="space-y-3 px-4 py-3 text-xs text-mute">
                      {proj ? (
                        <p>
                          <span className="text-faint">Model: </span>
                          <span className="text-foreground">
                            {statText(summary.key, proj.projected)}
                          </span>{" "}
                          = form {statText(summary.key, proj.form)} × opponent defense{" "}
                          {proj.defense.toFixed(2)} × game script {proj.script.toFixed(2)}
                          {(proj.opportunity ?? 1) !== 1
                            ? ` × teammate out ${(proj.opportunity ?? 1).toFixed(2)}`
                            : ""}{" "}
                          · built on {proj.games} games this season
                          {proj.lastSeason !== undefined
                            ? ` + last season (${statText(summary.key, proj.lastSeason)} a game)`
                            : ""}
                        </p>
                      ) : null}
                      {(() => {
                        const u = usageFor(player.id);
                        if (!u) return null;
                        if (u.role === "backup")
                          return (
                            <p>
                              <span className="text-faint">Role: </span>
                              Backup — projected 0 because {u.starterName ?? "the starter"} is
                              expected to play. If he&apos;s ruled out, this player becomes the
                              starter and gets a full projection.
                            </p>
                          );
                        if (u.role === "rotation")
                          return (
                            <p>
                              <span className="text-faint">Role: </span>
                              Rotation player — projected per team game, counting the weeks he
                              didn&apos;t record a stat, so the number reflects how much he actually
                              plays.
                            </p>
                          );
                        return null;
                      })()}
                      {(() => {
                        const u = usageFor(player.id);
                        if (!u || (!u.targetShare && !u.carryShare)) return null;
                        return (
                          <p>
                            <span className="text-faint">Recent usage: </span>
                            {u.targetShare
                              ? `${Math.round(u.targetShare * 100)}% of team targets`
                              : ""}
                            {u.targetShare && u.carryShare ? " · " : ""}
                            {u.carryShare
                              ? `${Math.round(u.carryShare * 100)}% of team carries`
                              : ""}
                            {u.ruledOut ? " · ruled out for this game" : ""}
                          </p>
                        );
                      })()}
                      {proj ? null : (
                        <p className="text-faint">
                          No projection yet: the model needs 2 games with this stat this season (1
                          if he played last season).
                        </p>
                      )}
                      {model && model.history.length ? (
                        <ModelHistory statKey={summary.key} model={model} />
                      ) : null}
                      <GameLogBars summary={summary} />
                      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                        <p>
                          <span className="text-faint">Median: </span>
                          {statText(summary.key, summary.median)} · {summary.games} games
                        </p>
                        <p>
                          <span className="text-faint">Season total: </span>
                          {wholeText(summary.total)} in {summary.games} games
                        </p>
                        <p>
                          <span className="text-faint">At or above average: </span>
                          {summary.log.filter((g) => g.value >= summary.avg).length} of{" "}
                          {summary.games} games
                        </p>
                        {kicking ? (
                          <>
                            <p>
                              <span className="text-faint">Field goals: </span>
                              {kicking.fgm}/{kicking.fga}
                              {kicking.fga
                                ? ` (${Math.round((kicking.fgm / kicking.fga) * 100)}%)`
                                : ""}
                              {kicking.longest ? ` · long ${kicking.longest}` : ""}
                            </p>
                            <p>
                              <span className="text-faint">Extra points: </span>
                              {kicking.xpm}/{kicking.xpa}
                              {kicking.xpa
                                ? ` (${Math.round((kicking.xpm / kicking.xpa) * 100)}%)`
                                : ""}
                            </p>
                          </>
                        ) : null}
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
  );
}

/* ---------- injury tags ---------- */

interface InjuryTagInfo {
  tag: string;
  status: string;
  detail?: string;
  /** Out / Doubtful / IR (red) vs Questionable (neutral). */
  out: boolean;
}

function InjuryTag({ info }: { info?: InjuryTagInfo }) {
  if (!info) return null;
  const title = `${info.status}${info.detail ? ` · ${info.detail}` : ""}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider ring-1 ${
        info.out ? "bg-loss/15 text-loss ring-loss/30" : "bg-panel2 text-foreground ring-line/25"
      }`}
    >
      {info.tag}
    </span>
  );
}

/* ---------- model vs actual ---------- */

function ModelHistory({ statKey, model }: { statKey: string; model: PlayerStatModel }) {
  const a = model.accuracy;
  return (
    <div>
      <p className="mb-1.5">
        <span className="text-faint">Model on his earlier games: </span>
        {a.inRangePct ?? "—"}% inside the range · average miss {a.mae ?? "—"} · beat the projection{" "}
        {a.overPct ?? "—"}% of the time
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {model.history.map((h) => {
          const hit = h.actual >= h.lower && h.actual <= h.upper;
          return (
            <div
              key={`${h.week}-${h.opponent}`}
              className="w-[4.5rem] shrink-0 rounded-md bg-panel2/60 px-2 py-1.5 text-center ring-1 ring-line/10"
              title={`Week ${h.week} vs ${h.opponent}: projected ${statText(statKey, h.projected)} (${h.lower}–${h.upper}), actual ${wholeText(h.actual)}`}
            >
              <p className="font-mono text-[9px] uppercase text-faint">
                W{h.week} {h.opponent}
              </p>
              <p className={`font-mono text-sm tabular-nums ${hit ? "text-win" : "text-loss"}`}>
                {wholeText(h.actual)}
              </p>
              <p className="font-mono text-[9px] tabular-nums text-mute">
                proj {statText(statKey, h.projected)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
