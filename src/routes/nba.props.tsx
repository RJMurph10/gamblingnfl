import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { Chip, EmptyPanel, NbaLogo, statusText } from "@/components/nba/NbaBits";
import { NbaPropsBoard } from "@/components/nba/NbaPropsBoard";
import { etDayKey, etShortLabel, localTip, type NbaGame } from "@/lib/nba";
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
        content: "Game-by-game NBA player prop projections: pick a slate day, pick a game, and see projected stat ranges and DraftKings edges.",
      },
    ],
  }),
  component: NbaPropsPage,
});

function SlateCard({ game, selected, onSelect }: { game: NbaGame; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${selected ? "border-acc/60 bg-acc/10 ring-1 ring-acc/30" : "border-line/10 bg-panel2/30 hover:border-line/25 hover:bg-panel2/60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          {[game.away, game.home].map((s) => (
            <div key={s.team.id} className="flex items-center gap-2">
              <NbaLogo team={s.team} className="size-5" />
              <span className="truncate text-sm font-semibold">{s.team.nickname}</span>
            </div>
          ))}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs font-semibold tabular-nums" suppressHydrationWarning>{localTip(game.date)}</p>
          <p className={`mt-1 font-mono text-[10px] uppercase tracking-wider ${game.status === "live" ? "text-win" : "text-mute"}`} suppressHydrationWarning>
            {game.status === "scheduled" ? (game.broadcast ?? "Upcoming") : statusText(game)}
          </p>
        </div>
      </div>
    </button>
  );
}

function mondayOf(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date, 12));
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function shiftDay(day: string, offset: number) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + offset, 12));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function NbaPropsPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNbaSchedule(30_000);
  // The visible strip starts Monday and spans seven calendar days. Moving forward shifts it one day.
  const slate = useMemo(() => games.filter((g) => g.status !== "postponed"), [games]);
  const linked = search.game ? slate.find((g) => g.id === search.game) : undefined;
  const initialDay = linked ? etDayKey(linked.date) : (defaultNbaDay(slate) ?? etDayKey(new Date()));
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [windowStartKey, setWindowStartKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(search.game ?? null);
  const strip = useRef<HTMLDivElement>(null);
  const day = dayKey ?? initialDay;
  const windowStart = windowStartKey ?? mondayOf(initialDay);
  const shownDays = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDay(windowStart, i)), [windowStart]);

  const dayGames = slate.filter((g) => etDayKey(g.date) === day);
  const selected = dayGames.find((g) => g.id === gameId) ?? dayGames[0];

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day, windowStart]);

  const pickDay = (nextDay: string) => {
    setDayKey(nextDay);
    setGameId(null);
  };

  const shiftWindow = (offset: number) => {
    const nextStart = shiftDay(windowStart, offset);
    const nextEnd = shiftDay(nextStart, 6);
    setWindowStartKey(nextStart);
    if (day < nextStart || day > nextEnd) setDayKey(nextStart);
  };

  return (
    <>
      <PageTitle title="Player Props" />
      {shownDays.length ? (
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            disabled={!day}
            onClick={() => shiftWindow(-1)}
            className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10 enabled:hover:text-acc disabled:opacity-40"
            aria-label="Previous day"
          >
            ←
          </button>
          <div ref={strip} className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Slate day">
            {shownDays.map((d) => (
              <Chip key={d} active={d === day} onClick={() => pickDay(d)}>
                {etShortLabel(d)}
              </Chip>
            ))}
          </div>
          <button
            type="button"
            disabled={!day}
            onClick={() => shiftWindow(1)}
            className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10 enabled:hover:text-acc disabled:opacity-40"
            aria-label="Next day"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => { setWindowStartKey(mondayOf(initialDay)); setDayKey(initialDay); setGameId(null); }}
            className="rounded-full bg-acc/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Today
          </button>
        </div>
      ) : null}
      {isLoading ? (
        <EmptyPanel>Loading the schedule…</EmptyPanel>
      ) : !dayGames.length ? (
        <EmptyPanel>{isError ? "The schedule couldn't be loaded right now." : "No games are scheduled for this date."}</EmptyPanel>
      ) : (
        <div className="space-y-6">
          <Panel padded={false}>
            <PanelHeader
              title="Slate"
              aside={<span className="font-mono text-[10px] uppercase tracking-wider text-mute">{dayGames.length} {dayGames.length === 1 ? "game" : "games"}</span>}
            />
            <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
              {dayGames.map((g) => (
                <SlateCard key={g.id} game={g} selected={g.id === selected?.id} onSelect={() => setGameId(g.id)} />
              ))}
            </div>
          </Panel>
          {selected ? <NbaPropsBoard key={selected.id} game={selected} /> : null}
        </div>
      )}
    </>
  );
}
