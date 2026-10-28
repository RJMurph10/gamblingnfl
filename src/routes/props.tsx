import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { GamePropAnalysis, TeamLink } from "@/components/shared/GamePropAnalysis";
import type { Game } from "@/data/shared/games";
import { teamById } from "@/data/shared/teams";
import { getLiveSchedule } from "@/lib/shared/espn.functions";
import { buildSlateDays, defaultSlateDay, pickSlateWeek } from "@/lib/shared/prop-slate";

export const Route = createFileRoute("/props")({
  head: () => ({
    meta: [
      { title: "Player Props — GamblingNFL" },
      {
        name: "description",
        content:
          "Game-by-game player prop projections: pick a slate day, pick a game, and see projected stat ranges for both teams.",
      },
      { property: "og:title", content: "Player Props — GamblingNFL" },
      {
        property: "og:description",
        content: "Projected player stats and ranges for every game on the slate.",
      },
    ],
  }),
  component: PropsPage,
});

const kickoffTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "TBD";

function GameCard({ game, selected, onSelect }: { game: Game; selected: boolean; onSelect: () => void }) {
  const away = teamById(game.awayTeamId);
  const home = teamById(game.homeTeamId);
  if (!away || !home) return null;
  const live = game.status === "live";
  const final = game.status === "final";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={selected}
      className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-acc/60 bg-acc/10 ring-1 ring-acc/30"
          : "border-line/10 bg-panel2/30 hover:border-line/25 hover:bg-panel2/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          {[away, home].map((team) => (
            <div key={team.id} className="flex items-center gap-2">
              <TeamLink team={team} className="size-5" />
              <span className="truncate text-sm font-semibold">{team.name}</span>
            </div>
          ))}
        </div>
        <div className="shrink-0 text-right">
          <p suppressHydrationWarning className="font-mono text-xs font-semibold tabular-nums">
            {kickoffTime(game.kickoffIso)}
          </p>
          {live ? (
            // Green, and a shortcut to the live game (without selecting the card).
            <Link
              to="/games/$gameId"
              params={{ gameId: game.id }}
              onClick={(event) => event.stopPropagation()}
              title="Open the live game"
              className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-win hover:underline"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-win" aria-hidden />
              Live{game.clock ? ` · ${game.clock}` : ""}
            </Link>
          ) : (
            <p
              className={`mt-1 font-mono text-[10px] uppercase tracking-wider ${
                final ? "text-faint" : "text-mute"
              }`}
            >
              {final ? "Final" : (game.broadcast ?? game.info?.broadcast ?? "Upcoming")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PropsPage() {
  const scheduleQuery = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });

  // The real schedule only: never substitute sample games.
  const games: Game[] = scheduleQuery.data ?? [];
  const week = useMemo(() => pickSlateWeek(games), [games]);
  const days = useMemo(() => buildSlateDays(games, week), [games, week]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const activeDay = days.find((d) => d.key === dayKey) ?? defaultSlateDay(days);
  // Changing the day falls back to that day's first game, never the previous matchup.
  const selectedGame = activeDay?.games.find((g) => g.id === gameId) ?? activeDay?.games[0];
  const away = selectedGame ? teamById(selectedGame.awayTeamId) : undefined;
  const home = selectedGame ? teamById(selectedGame.homeTeamId) : undefined;

  return (
    <>
      <PageTitle eyebrow={week ? `Week ${week} · player projections` : "Player projections"} title="Player Props" />

      {scheduleQuery.isLoading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">Loading the schedule…</p>
        </Panel>
      ) : days.length === 0 ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            {scheduleQuery.isError
              ? "The schedule couldn't be loaded right now."
              : "No games are scheduled for the current slate."}
          </p>
        </Panel>
      ) : (
        <div className="space-y-6">
          {/* Level 1 + 2: slate days and the selected day's games */}
          <Panel padded={false}>
            <PanelHeader
              title="Slate"
              aside={
                activeDay ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    {activeDay.dateLabel} · {activeDay.games.length} {activeDay.games.length === 1 ? "game" : "games"}
                  </span>
                ) : null
              }
            />
            <div className="flex gap-2 overflow-x-auto px-4 py-3" role="tablist" aria-label="Slate day">
              {days.map((day) => {
                const active = day.key === activeDay?.key;
                return (
                  <button
                    key={day.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setDayKey(day.key);
                      setGameId(null);
                    }}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
                      active ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeDay?.games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  selected={game.id === selectedGame?.id}
                  onSelect={() => setGameId(game.id)}
                />
              ))}
            </div>
          </Panel>

          {/* Level 3: the selected game's offensive projections */}
          {selectedGame && away && home ? (
            <GamePropAnalysis key={selectedGame.id} game={selectedGame} away={away} home={home} />
          ) : null}
        </div>
      )}
    </>
  );
}
