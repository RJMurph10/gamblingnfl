import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { Chip, EmptyPanel, NbaGameCard } from "@/components/nba/NbaBits";
import { etDayKey, etDayLabel, etShortLabel } from "@/lib/nba";
import { defaultNbaDay, useNbaModelRows, useNbaSchedule } from "@/lib/use-nba";

export const Route = createFileRoute("/nba/games/")({
  head: () => ({
    meta: [
      { title: "NBA Games by Day — GamblingNBA" },
      {
        name: "description",
        content: "Every NBA game by day: live scores, spreads, totals, the model's lean and full game breakdowns.",
      },
    ],
  }),
  component: NbaGames,
});

type Filter = "all" | "live" | "final" | "upcoming";

function NbaGames() {
  const { games, isLoading, isError } = useNbaSchedule(60_000);
  const rows = useNbaModelRows(games);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const days = useMemo(() => [...new Set(games.map((g) => etDayKey(g.date)).filter(Boolean))].sort(), [games]);
  const day = picked ?? defaultNbaDay(games);
  const dayGames = useMemo(
    () =>
      games
        .filter((g) => etDayKey(g.date) === day)
        .filter((g) =>
          filter === "all" ? true : filter === "live" ? g.status === "live" : filter === "final" ? g.status === "final" : g.status === "scheduled",
        ),
    [games, day, filter],
  );
  const idx = day ? days.indexOf(day) : -1;

  // Keep the selected day visible in the horizontal strip.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day, days.length]);

  return (
    <>
      <PageTitle
        eyebrow={games.length ? "NBA · Live data" : "Live ESPN schedule"}
        title="Games"
        aside={
          <div className="flex flex-wrap gap-2">
            {(["all", "live", "upcoming", "final"] as Filter[]).map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f}
              </Chip>
            ))}
          </div>
        }
      />
      {days.length ? (
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            disabled={idx <= 0}
            onClick={() => setPicked(days[idx - 1])}
            className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10 enabled:hover:text-acc disabled:opacity-40"
            aria-label="Previous day"
          >
            ←
          </button>
          <div ref={strip} className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {days.map((d) => (
              <Chip key={d} active={d === day} onClick={() => setPicked(d)}>
                {etShortLabel(d)}
              </Chip>
            ))}
          </div>
          <button
            type="button"
            disabled={idx < 0 || idx >= days.length - 1}
            onClick={() => setPicked(days[idx + 1])}
            className="rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] text-mute ring-1 ring-line/10 enabled:hover:text-acc disabled:opacity-40"
            aria-label="Next day"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="rounded-full bg-acc/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-acc ring-1 ring-acc/25"
          >
            Today
          </button>
        </div>
      ) : null}
      {!dayGames.length ? (
        <EmptyPanel>
          {isLoading
            ? "Loading games from ESPN…"
            : isError
              ? "Could not load games from ESPN. Try refreshing shortly."
              : games.length
                ? "No games match this filter on this day."
                : "No NBA games are currently available from ESPN."}
        </EmptyPanel>
      ) : (
        <Panel padded={false}>
          <PanelHeader
            title={day ? etDayLabel(day) : "Games"}
            aside={
              <span className="label-mono">
                {dayGames.length} {dayGames.length === 1 ? "game" : "games"}
              </span>
            }
          />
          <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {dayGames.map((g) => (
              <NbaGameCard key={g.id} game={g} row={rowById.get(g.id)} />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
