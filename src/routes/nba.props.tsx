
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { EmptyPanel, NbaLogo, statusText } from "@/components/nba/NbaBits";
import { NbaPropsBoard } from "@/components/nba/NbaPropsBoard";
import { etDayKey, localTip, type NbaGame } from "@/lib/nba";
import { defaultNbaDay, useNbaSchedule } from "@/lib/use-nba";

export const Route = createFileRoute("/nba/props")({
  validateSearch: (search: Record<string, unknown>): { game?: string } => ({
    game: typeof search.game === "string" ? search.game : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Player Props — GamblingNBA" },
      {
        name: "description",
        content:
          "Game-by-game NBA player prop projections: pick a slate day, pick a game, and see projected stat ranges and DraftKings edges.",
      },
    ],
  }),
  component: NbaPropsPage,
});

function formatSlateDate(day: string, gameCount: number) {
  const date = new Date(`${day}T12:00:00-04:00`);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);

  return `${dateLabel} · ${gameCount} ${gameCount === 1 ? "game" : "games"}`;
}

function formatWeekday(day: string) {
  const date = new Date(`${day}T12:00:00-04:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(date).toUpperCase();
}

function SlateCard({
  game,
  selected,
  onSelect,
}: {
  game: NbaGame;
  selected: boolean;
  onSelect: () => void;
}) {
  const isFinal = game.status === "final";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-4 text-left transition-colors sm:p-5 ${
        selected
          ? "border-acc/80 bg-acc/[0.10] ring-1 ring-acc/50"
          : "border-line/15 bg-panel2/20 hover:border-line/30 hover:bg-panel2/40"
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-3">
          {[game.away, game.home].map((side) => (
            <div key={side.team.id} className="flex items-center gap-3">
              <NbaLogo team={side.team} className="size-7 shrink-0" />
              <span className="truncate text-base font-semibold sm:text-lg">
                {side.team.nickname}
              </span>
            </div>
          ))}
        </div>

        <div className="shrink-0 text-right">
          <p
            className="font-mono text-sm font-semibold tabular-nums sm:text-base"
            suppressHydrationWarning
          >
            {localTip(game.date)}
          </p>
          <p
            className={`mt-2 text-xs uppercase tracking-wider sm:text-sm ${
              game.status === "live"
                ? "text-win"
                : isFinal
                  ? "text-mute"
                  : "text-mute"
            }`}
            suppressHydrationWarning
          >
            {game.status === "scheduled"
              ? game.broadcast ?? "Upcoming"
              : statusText(game)}
          </p>
        </div>
      </div>
    </button>
  );
}

function NbaPropsPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNbaSchedule(30_000);

  const slate = useMemo(
    () => games.filter((game) => game.status !== "postponed"),
    [games]
  );

  const days = useMemo(() => {
    const today = etDayKey(new Date());

    return [
      ...new Set(slate.map((game) => etDayKey(game.date))),
    ]
      .sort()
      .filter((day) => day >= today)
      .slice(0, 7);
  }, [slate]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(
    search.game ?? null
  );

  const linkedGame = search.game
    ? slate.find((game) => game.id === search.game)
    : undefined;

  const day =
    dayKey ??
    (linkedGame
      ? etDayKey(linkedGame.date)
      : days.includes(defaultNbaDay(slate) ?? "")
        ? defaultNbaDay(slate)
        : days[0] ?? defaultNbaDay(slate));

  const dayGames = slate.filter(
    (game) => day !== null && etDayKey(game.date) === day
  );

  const selectedGame =
    dayGames.find((game) => game.id === gameId) ?? dayGames[0];

  const pickDay = (nextDay: string) => {
    setDayKey(nextDay);
    setGameId(null);
  };

  return (
    <>
      <PageTitle title="Player Props" />

      {isLoading ? (
        <EmptyPanel>Loading the schedule…</EmptyPanel>
      ) : !dayGames.length ? (
        <EmptyPanel>
          {isError
            ? "The schedule couldn't be loaded right now."
            : "No games are scheduled for the current slate."}
        </EmptyPanel>
      ) : (
        <div className="space-y-6">
          <Panel padded={false}>
            <PanelHeader
              title="Slate"
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute sm:text-xs">
                  {day ? formatSlateDate(day, dayGames.length) : ""}
                </span>
              }
            />

            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <div
                className="mb-4 flex gap-2 overflow-x-auto pb-1"
                role="tablist"
                aria-label="Slate day"
              >
                {days.map((date) => {
                  const active = date === day;

                  return (
                    <button
                      key={date}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => pickDay(date)}
                      className={`shrink-0 rounded-full border px-4 py-2 text-xs font-medium tracking-wide transition-colors sm:px-6 sm:text-sm ${
                        active
                          ? "border-acc/40 bg-acc/10 text-acc"
                          : "border-line/15 bg-panel2/20 text-mute hover:border-line/30 hover:text-foreground"
                      }`}
                    >
                      {formatWeekday(date)}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {dayGames.map((game) => (
                  <SlateCard
                    key={game.id}
                    game={game}
                    selected={game.id === selectedGame?.id}
                    onSelect={() => setGameId(game.id)}
                  />
                ))}
              </div>
            </div>
          </Panel>

          {selectedGame ? (
            <NbaPropsBoard key={selectedGame.id} game={selectedGame} />
          ) : null}
        </div>
      )}
    </>
  );
}
