import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, RankedLogo } from "@/components/booth";
import { CfbScopePicker } from "@/components/CfbScope";
import { DraftKingsPropsBoard } from "@/components/DraftKingsPropsBoard";
import type { Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { teamShort } from "@/lib/league-links";
import { buildSlateDays, defaultSlateDay, pickSlateWeek } from "@/lib/prop-slate";
import { scopeGames, useCfbConferences, useCfbSchedule, type CfbScope } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/props")({
  head: () => ({
    meta: [
      { title: "Player Props — GamblingCFB" },
      {
        name: "description",
        content:
          "College football player props: pick a slate day and a game to see DraftKings player lines from ESPN.",
      },
    ],
  }),
  component: CfbPropsPage,
});

const kickoffTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "TBD";

function SlateCard({
  game,
  selected,
  onSelect,
}: {
  game: Game;
  selected: boolean;
  onSelect: () => void;
}) {
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
          {[
            { team: away, rank: game.awayRank },
            { team: home, rank: game.homeRank },
          ].map(({ team, rank }) => (
            <div key={team.id} className="flex min-w-0 items-center gap-2">
              <RankedLogo team={team} className="size-5" />
              {rank ? <span className="font-mono text-[10px] text-acc">#{rank}</span> : null}
              <span className="truncate text-sm font-semibold">{teamShort(team)}</span>
            </div>
          ))}
        </div>
        <div className="shrink-0 text-right">
          <p suppressHydrationWarning className="font-mono text-xs font-semibold tabular-nums">
            {kickoffTime(game.kickoffIso)}
          </p>
          {live ? (
            <Link
              to="/cfb/games/$gameId"
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
              {final ? "Final" : (game.broadcast ?? "Upcoming")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CfbPropsPage() {
  const schedule = useCfbSchedule(30_000);
  const { conferences } = useCfbConferences();
  // Saturdays have 50+ games; ranked teams' games are where the props are.
  const [scope, setScope] = useState<CfbScope>("top25");
  const games = useMemo(
    () =>
      scopeGames(
        schedule.games.filter((g) => !g.fcs),
        scope,
      ),
    [schedule.games, scope],
  );
  const week = useMemo(() => pickSlateWeek(games), [games]);
  const days = useMemo(() => buildSlateDays(games, week), [games, week]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const activeDay = days.find((d) => d.key === dayKey) ?? defaultSlateDay(days);
  const selectedGame = activeDay?.games.find((g) => g.id === gameId) ?? activeDay?.games[0];
  const away = selectedGame ? teamById(selectedGame.awayTeamId) : undefined;
  const home = selectedGame ? teamById(selectedGame.homeTeamId) : undefined;

  return (
    <>
      <PageTitle
        eyebrow={week ? `Week ${week} · DraftKings lines` : "DraftKings lines"}
        title="Player Props"
        aside={
          <CfbScopePicker
            scope={scope}
            onChange={(s) => {
              setScope(s);
              setDayKey(null);
              setGameId(null);
            }}
            conferences={conferences}
          />
        }
      />

      {schedule.isLoading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">Loading the schedule…</p>
        </Panel>
      ) : days.length === 0 ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">
            {schedule.isError
              ? "The schedule couldn't be loaded right now."
              : "No games in this filter on the current slate."}
          </p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel padded={false}>
            <PanelHeader
              title="Slate"
              aside={
                activeDay ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                    {activeDay.dateLabel} · {activeDay.games.length}{" "}
                    {activeDay.games.length === 1 ? "game" : "games"}
                  </span>
                ) : null
              }
            />
            <div
              className="flex gap-2 overflow-x-auto px-4 py-3"
              role="tablist"
              aria-label="Slate day"
            >
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
                      active
                        ? "bg-acc/10 text-acc ring-acc/25"
                        : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeDay?.games.map((game) => (
                <SlateCard
                  key={game.id}
                  game={game}
                  selected={game.id === selectedGame?.id}
                  onSelect={() => setGameId(game.id)}
                />
              ))}
            </div>
          </Panel>

          {selectedGame && away && home ? (
            <DraftKingsPropsBoard
              key={selectedGame.id}
              game={selectedGame}
              away={away}
              home={home}
            />
          ) : null}
          <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
            Sportsbook lines as ESPN publishes them (usually ranked and televised games). Player
            projections come with the college model.
          </p>
        </div>
      )}
    </>
  );
}
