import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard, TeamLogo } from "@/components/booth";
import { CfbScopePicker } from "@/components/CfbScope";
import { LiveGamesPanel, RecentGamesPanel, UpcomingGames } from "@/components/GameTables";
import { gameScore, type Game } from "@/data/games";
import { buildSeasonPulse, changeTone, weekChangeText } from "@/lib/season-pulse";
import {
  currentCfbWeek,
  scopeGames,
  useCfbConferences,
  useCfbSchedule,
  useCfbTop25,
  type CfbScope,
} from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingCFB dashboard" },
      {
        name: "description",
        content:
          "FBS college football dashboard: how favorites and totals are doing against the closing lines, live and upcoming games, recent results and the Top 25.",
      },
    ],
  }),
  component: CfbDashboard,
});

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));

/** Overs vs unders on games with a closing total (pushes left out). */
function overRecord(games: Game[]) {
  let overs = 0;
  let unders = 0;
  for (const g of games) {
    if (g.status !== "final" || !g.total) continue;
    const s = gameScore(g);
    const pts = s.away + s.home;
    if (pts > g.total) overs++;
    else if (pts < g.total) unders++;
  }
  const n = overs + unders;
  return { overs, unders, pct: n ? (overs / n) * 100 : null };
}

const kickoffTime = (g: Game) => (g.kickoffIso ? new Date(g.kickoffIso).getTime() : 0);

function CfbDashboard() {
  const [scope, setScope] = useState<CfbScope>("all");
  const { games: all, isLoading, isError } = useCfbSchedule(60_000);
  const { conferences } = useCfbConferences();
  const top25 = useCfbTop25();

  const source = useMemo(() => scopeGames(all, scope), [all, scope]);
  // Lines are FBS-on-FBS: FCS games rarely have one and would skew the figures.
  const lined = useMemo(() => source.filter((g) => !g.fcs), [source]);
  const pulse = useMemo(() => buildSeasonPulse(lined), [lined]);
  const prevWeek = pulse.throughWeek === null ? null : pulse.throughWeek - 1;
  const overs = useMemo(() => overRecord(lined), [lined]);
  const oversBefore = useMemo(
    () => (prevWeek === null ? null : overRecord(lined.filter((g) => g.week <= prevWeek))),
    [lined, prevWeek],
  );
  const overChange =
    overs.pct !== null && oversBefore?.pct !== null && oversBefore?.pct !== undefined
      ? Math.round((overs.pct - oversBefore.pct) * 10) / 10
      : null;

  const live = source.filter((g) => g.status === "live");
  const recent = useMemo(
    () =>
      source
        .filter((g) => g.status === "final")
        .sort((a, b) => b.week - a.week || kickoffTime(b) - kickoffTime(a))
        .slice(0, 8),
    [source],
  );
  const week = currentCfbWeek(all);
  const fav = pulse.favoriteWinRate;
  const cover = pulse.favoriteCoverRate;
  const loadingNote = isLoading ? "Loading…" : undefined;
  const sample = (n: number) => `${n} ${n === 1 ? "game" : "games"}`;

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={`Home dashboard · FBS${week ? ` · Week ${week}` : ""}`}
          title="Season Pulse"
          aside={<CfbScopePicker scope={scope} onChange={setScope} conferences={conferences} />}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Favorites · win rate"
            value={fmt(fav.value)}
            unit={fav.value === null ? undefined : "%"}
            note={
              loadingNote ??
              [weekChangeText(fav.weekChange), `${sample(fav.sample)} straight up`]
                .filter(Boolean)
                .join(" · ")
            }
            tone={changeTone(fav.weekChange)}
          />
          <StatCard
            label="Favorites · cover %"
            value={fmt(cover.value)}
            unit={cover.value === null ? undefined : "%"}
            note={
              loadingNote ??
              [weekChangeText(cover.weekChange), `${sample(cover.sample)} ATS`]
                .filter(Boolean)
                .join(" · ")
            }
            tone={changeTone(cover.weekChange)}
          />
          <StatCard
            label="Overs · hit rate"
            value={fmt(overs.pct)}
            unit={overs.pct === null ? undefined : "%"}
            note={
              loadingNote ??
              [weekChangeText(overChange), `${overs.overs}-${overs.unders} over/under`]
                .filter(Boolean)
                .join(" · ")
            }
            tone={changeTone(overChange)}
          />
          <StatCard
            label="Avg points · vs line"
            value={fmt(pulse.avgTotal.value)}
            note={
              loadingNote ??
              (pulse.avgTotalLine !== null
                ? `closing total avg ${pulse.avgTotalLine.toFixed(1)}`
                : "No totals graded yet")
            }
            tone={
              pulse.avgTotal.value !== null && pulse.avgTotalLine !== null
                ? pulse.avgTotal.value > pulse.avgTotalLine
                  ? "win"
                  : "loss"
                : "mute"
            }
          />
        </div>
        {pulse.throughWeek !== null ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            Through week {pulse.throughWeek} · FBS vs FBS games at closing ESPN lines ·{" "}
            <Link to="/cfb/model" className="text-acc">
              Model →
            </Link>
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <LiveGamesPanel games={live} />
          <UpcomingGames games={source} />
          <RecentGamesPanel
            games={recent}
            allGamesTo="/cfb/games"
            emptyText={
              isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : "No completed games yet."
            }
          />
        </section>

        <aside className="min-w-0 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              {top25.poll || "Top 25"}
            </h2>
            <p className="label-mono mb-3">This week · tap to open</p>
            {top25.ranks.length ? (
              <div className="grid grid-cols-5 gap-2">
                {top25.ranks.map((r) => (
                  <Link
                    key={r.team.id}
                    to="/cfb/teams/$teamId"
                    params={{ teamId: r.team.id }}
                    title={`#${r.rank} ${r.team.city}${r.record ? ` (${r.record})` : ""}`}
                    className="glass relative grid aspect-square place-items-center rounded-xl hover:glow"
                    style={{ boxShadow: `inset 0 0 0 1px ${r.team.color}44` }}
                  >
                    <span className="absolute left-1 top-0.5 font-mono text-[9px] font-bold text-acc">
                      {r.rank}
                    </span>
                    <TeamLogo team={r.team} className="size-8" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center font-mono text-xs text-mute">
                {top25.isLoading ? "Loading rankings…" : "Rankings unavailable."}
              </p>
            )}
            <Link
              to="/cfb/teams"
              className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              + all FBS teams
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}
