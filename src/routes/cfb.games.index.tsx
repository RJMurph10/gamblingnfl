import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { CfbScopePicker } from "@/components/CfbScope";
import { GameCard } from "@/components/GameCard";
import type { Game } from "@/data/games";
import {
  currentCfbWeek,
  scopeGames,
  useCfbConferences,
  useCfbSchedule,
  type CfbScope,
} from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/games/")({
  head: () => ({
    meta: [
      { title: "Games by Week — GamblingCFB" },
      {
        name: "description",
        content: "Every FBS game by week: live scores, spreads, totals and full game breakdowns.",
      },
    ],
  }),
  component: CfbGames,
});

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "short",
  day: "numeric",
});

function CfbGames() {
  const { games: all, isLoading, isError } = useCfbSchedule(60_000);
  const { conferences } = useCfbConferences();
  const [scope, setScope] = useState<CfbScope>("all");
  const [picked, setPicked] = useState<number | null>(null);

  const weeks = useMemo(() => [...new Set(all.map((g) => g.week))].sort((a, b) => a - b), [all]);
  const week = picked ?? currentCfbWeek(all);
  const games = useMemo(
    () =>
      scopeGames(
        all.filter((g) => g.week === week),
        scope,
      ),
    [all, week, scope],
  );

  // One panel per kickoff day (Eastern), like a TV listing.
  const days = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of games) {
      const key = g.kickoffIso ? ET_DAY.format(new Date(g.kickoffIso)) : "Time TBA";
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()];
  }, [games]);

  return (
    <>
      <PageTitle
        eyebrow={all.length ? "FBS · Live data" : "Live ESPN schedule"}
        title="Games"
        aside={<CfbScopePicker scope={scope} onChange={setScope} conferences={conferences} />}
      />
      {weeks.length ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {weeks.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setPicked(w)}
              aria-pressed={w === week}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                w === week
                  ? "bg-acc/10 text-acc ring-acc/25"
                  : "bg-panel2 text-mute ring-line/10 hover:text-acc"
              }`}
            >
              Wk {w}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-4">
        {!all.length || !games.length ? (
          <Panel>
            <p className="text-center font-mono text-xs text-mute">
              {isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : all.length
                    ? "No games in this filter this week."
                    : "No games are currently available from ESPN."}
            </p>
          </Panel>
        ) : null}
        {days.map(([day, list]) => (
          <Panel key={day} padded={false}>
            <PanelHeader
              title={day}
              aside={
                <span className="label-mono">
                  Wk {week} · {list.length} {list.length === 1 ? "game" : "games"}
                </span>
              }
            />
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
