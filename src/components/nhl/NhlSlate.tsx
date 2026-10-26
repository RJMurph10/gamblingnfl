/** The NHL slate: day tabs, a compact card per game, and the selected game's model-vs-market analysis. */
import { useMemo, useState } from "react";
import { Panel, PanelHeader } from "@/components/booth";
import { NhlEmpty, NhlLogo } from "@/components/nhl/NhlBits";
import { NhlGameBoard } from "@/components/nhl/NhlGameBoard";
import { defaultNhlDay, etDayKey, localTip, slateDays, statusText, type NhlGame } from "@/lib/nhl";

/** "MON, OCT 26 · 9 GAMES" (Eastern-time day). */
function formatSlateDate(day: string, gameCount: number) {
  const [year, month, date] = day.split("-").map(Number);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date, 17)));
  return `${dateLabel} · ${gameCount} ${gameCount === 1 ? "game" : "games"}`.toUpperCase();
}

function formatWeekday(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" })
    .format(new Date(Date.UTC(year, month - 1, date, 17)))
    .toUpperCase();
}

function SlateCard({ game, selected, onSelect }: { game: NhlGame; selected: boolean; onSelect: () => void }) {
  const started = game.status === "live" || game.status === "final";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-acc/70 bg-acc/[0.10] ring-1 ring-acc/30"
          : "border-line/15 bg-panel2/20 hover:border-line/30 hover:bg-panel2/40"
      } ${game.status === "postponed" ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {[game.away, game.home].map((side) => (
            <div key={side.team.id} className="flex items-center gap-2.5">
              <NhlLogo team={side.team} className="size-5 shrink-0" />
              <span className="truncate text-sm font-semibold">{side.team.nickname}</span>
              {started && side.score !== null ? (
                <span className="ml-auto pr-1 font-mono text-sm font-semibold tabular-nums">{side.score}</span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-xs font-semibold tabular-nums" suppressHydrationWarning>
            {game.status === "postponed" ? "TBD" : localTip(game.date)}
          </p>
          <p
            className={`mt-1 font-mono text-[10px] uppercase tracking-wider ${
              game.status === "live" ? "text-win" : "text-mute"
            }`}
            suppressHydrationWarning
          >
            {game.status === "scheduled" ? (game.broadcast ?? "Upcoming") : statusText(game)}
          </p>
        </div>
      </div>
    </button>
  );
}

export function NhlSlate({
  games,
  isLoading,
  isError,
  initialGame,
}: {
  games: NhlGame[];
  isLoading: boolean;
  isError: boolean;
  initialGame?: string;
}) {

  // Preseason games are left off: the slate is the regular season and playoffs.
  const slate = useMemo(() => games.filter((game) => game.part !== "pre"), [games]);
  const days = useMemo(() => slateDays(slate, 7), [slate]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(initialGame ?? null);

  const linkedGame = initialGame ? slate.find((game) => game.id === initialGame) : undefined;
  const fallbackDay = defaultNhlDay(slate);
  const day =
    dayKey ??
    (linkedGame
      ? etDayKey(linkedGame.date)
      : fallbackDay && days.includes(fallbackDay)
        ? fallbackDay
        : (days[0] ?? fallbackDay));

  // A linked game outside the next seven days still gets its own tab.
  const tabs = day && !days.includes(day) ? [...days, day].sort() : days;
  const dayGames = slate.filter((game) => day !== null && etDayKey(game.date) === day);
  const selectedGame = dayGames.find((game) => game.id === gameId) ?? dayGames[0];

  const pickDay = (nextDay: string) => {
    setDayKey(nextDay);
    setGameId(null);
  };

  return (
    <>
      {isLoading ? (
        <NhlEmpty>Loading the schedule…</NhlEmpty>
      ) : !dayGames.length ? (
        <NhlEmpty>
          {isError ? "The schedule couldn't be loaded right now." : "No games are scheduled for the current slate."}
        </NhlEmpty>
      ) : (
        <div className="space-y-4">
          <Panel padded={false}>
            <PanelHeader
              title="Slate"
              aside={
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute sm:text-xs">
                  {day ? formatSlateDate(day, dayGames.length) : ""}
                </span>
              }
            />

            <div className="px-3 pb-3 sm:px-4 sm:pb-4">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Slate day">
                {tabs.map((date) => {
                  const active = date === day;
                  return (
                    <button
                      key={date}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => pickDay(date)}
                      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] font-medium tracking-wide transition-colors sm:px-4 sm:text-xs ${
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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

          {selectedGame ? <NhlGameBoard key={selectedGame.id} game={selectedGame} games={slate} /> : null}
        </div>
      )}
    </>
  );
}
