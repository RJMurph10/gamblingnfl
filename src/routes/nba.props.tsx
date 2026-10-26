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

function NbaPropsPage() {
  const search = Route.useSearch();
  const { games, isLoading, isError } = useNbaSchedule(30_000);
  // Keep the props slate focused on the next seven available game dates.
  const slate = useMemo(() => games.filter((g) => g.status !== "postponed"), [games]);
  const days = useMemo(() => {
    const today = etDayKey(new Date());
    return [...new Set(slate.map((g) => etDayKey(g.date)))].sort().filter((d) => d >= today).slice(0, 7);
  }, [slate]);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(search.game ?? null);
  const strip = useRef<HTMLDivElement>(null);

  const linked = search.game ? slate.find((g) => g.id === search.game) : undefined;
  const day = dayKey ?? (linked ? etDayKey(linked.date) : (days.includes(defaultNbaDay(slate) ?? "") ? defaultNbaDay(slate) : days[0] ?? defaultNbaDay(slate)));
  const dayGames = slate.filter((g) => day !== null && etDayKey(g.date) === day);
  const selected = dayGames.find((g) => g.id === gameId) ?? dayGames[0];
  const shownDays = day && !days.includes(day) ? [day, ...days] : days;
  const idx = day ? shownDays.indexOf(day) : -1;

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day, shownDays.length]);

  const pickDay = (nextDay: string) => {
    setDayKey(nextDay);
    setGameId(null);
  };

  return (
    <>
      <PageTitle title="Player Props" />
      {shownDays.length ? (
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            disabled={idx <= 0}
            onClick={() => pickDay(shownDays[idx - 1])}
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
            disabled={idx < 0 || idx >= shownDays.length - 1}
            onClick={() => pickDay(shownDays[idx + 1])}
            className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10 enabled:hover:text-acc disabled:opacity-40"
            aria-label="Next day"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => { setDayKey(defaultNbaDay(slate) ?? null); setGameId(null); }}
            className="rounded-full bg-acc/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Today
          </button>
        </div>
      ) : null}
      {isLoading ? (
        <EmptyPanel>Loading the schedule…</EmptyPanel>
      ) : !dayGames.length ? (
        <EmptyPanel>{isError ? "The schedule couldn't be loaded right now." : "No games are scheduled for the current slate."}</EmptyPanel>
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
