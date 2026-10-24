import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard, TeamLogo } from "@/components/booth";
import { LiveGamesPanel, RecentGamesPanel, UpcomingGames } from "@/components/GameTables";
import type { Game } from "@/data/games";
import { runCfbModel } from "@/lib/cfb-model";
import { summarizeModel, unitsText } from "@/lib/game-model";
import { buildSeasonPulse, changeTone, weekChangeText } from "@/lib/season-pulse";
import { useCfbPriorSeason, useCfbSchedule, useCfbTop25 } from "@/lib/use-cfb";

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

const kickoffTime = (g: Game) => (g.kickoffIso ? new Date(g.kickoffIso).getTime() : 0);

function CfbDashboard() {
  const {
    games: source,
    isLoading: scheduleLoading,
    isError: scheduleError,
  } = useCfbSchedule(60_000);
  const top25 = useCfbTop25();
  const priorSeason = useCfbPriorSeason();
  const isLive = source.length > 0;

  const recent = useMemo(
    () =>
      source
        .filter((g) => g.status === "final")
        .sort((a, b) => b.week - a.week || kickoffTime(b) - kickoffTime(a))
        .slice(0, 5),
    [source],
  );
  const live = source.filter((g) => g.status === "live");

  // Season Pulse: the model's record and units (flat 1u), plus the average total.
  const pulse = useMemo(() => buildSeasonPulse(source.filter((g) => !g.fcs)), [source]);
  const modelRows = useMemo(() => runCfbModel(source, priorSeason), [source, priorSeason]);
  // Accuracy cards grade every game; the units card follows the best bets (what it would bet).
  const model = useMemo(() => summarizeModel(modelRows, "predictions"), [modelRows]);
  const bets = useMemo(() => summarizeModel(modelRows, "bets"), [modelRows]);
  const prev = model.previous;
  const pctChange = (now: number | null, before: number | null | undefined) =>
    now !== null && before !== null && before !== undefined
      ? Math.round((now - before) * 10) / 10
      : null;
  const winner = model.byMarket.moneyline;
  const winChange = pctChange(winner.winPct, prev?.byMarket.moneyline.winPct);
  const coverChange = pctChange(model.byMarket.spread.winPct, prev?.byMarket.spread.winPct);
  const totalChange = pctChange(model.byMarket.total.winPct, prev?.byMarket.total.winPct);
  const unitsChange = bets.previous
    ? Math.round((bets.overall.units - bets.previous.overall.units) * 100) / 100
    : null;
  const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
  const rec = (r: { wins: number; losses: number; pushes: number }) =>
    `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
  const note = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={isLive ? "Home dashboard · 2026 live schedule" : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winner.winPct)}
            unit={winner.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(weekChangeText(winChange), `${rec(winner)} picking winners`)
            }
            tone={changeTone(winChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(model.byMarket.total.winPct)}
            unit={model.byMarket.total.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(
                    weekChangeText(totalChange),
                    `${rec(model.byMarket.total)} O/U`,
                    pulse.avgTotal.value !== null && pulse.avgTotalLine !== null
                      ? `games avg ${pulse.avgTotal.value.toFixed(1)} vs line ${pulse.avgTotalLine.toFixed(1)}`
                      : undefined,
                  )
            }
            tone={changeTone(totalChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(model.byMarket.spread.winPct)}
            unit={model.byMarket.spread.winPct === null ? undefined : "%"}
            note={
              scheduleLoading
                ? "Loading…"
                : note(weekChangeText(coverChange), `${rec(model.byMarket.spread)} ATS`)
            }
            tone={changeTone(coverChange)}
          />
          <StatCard
            label="Model edge · ★ best bets"
            value={unitsText(bets.overall.units)}
            note={
              scheduleLoading
                ? "Loading…"
                : note(
                    unitsChange === null
                      ? undefined
                      : `${unitsChange > 0 ? "▲" : unitsChange < 0 ? "▼" : "—"} ${Math.abs(unitsChange).toFixed(2)}u wk/wk`,
                    bets.overall.roi === null
                      ? "No best bets graded yet"
                      : `${rec(bets.overall)} · ROI ${bets.overall.roi > 0 ? "+" : ""}${bets.overall.roi.toFixed(1)}%`,
                    `every game ${unitsText(model.overall.units)}`,
                  )
            }
            tone={bets.overall.units > 0 ? "win" : bets.overall.units < 0 ? "loss" : "mute"}
          />
        </div>
        {pulse.throughWeek !== null ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
            Through week {pulse.throughWeek} · flat 1u per pick at closing ESPN odds ·{" "}
            <Link to="/cfb/model" className="text-acc">
              Model picks →
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
              scheduleLoading
                ? "Loading games from ESPN…"
                : scheduleError
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
