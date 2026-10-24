import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { CfbGameCard } from "@/components/CfbGameCard";
import { getCfbConferences, getCfbWeek } from "@/lib/cfb.functions";

export const Route = createFileRoute("/cfb/games")({
  head: () => ({
    meta: [
      { title: "College football games — GamblingCFB" },
      {
        name: "description",
        content: "Every FBS game by week: scores, kickoff times, TV and lines.",
      },
    ],
  }),
  component: CfbGames,
});

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

function CfbGames() {
  const [week, setWeek] = useState<number | undefined>(undefined);
  const [filter, setFilter] = useState<string>("all");
  const weekQuery = useQuery({
    queryKey: ["cfb-week", week ?? "current"],
    queryFn: () => getCfbWeek({ data: week ? { week } : {} }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const confQuery = useQuery({
    queryKey: ["cfb-conferences"],
    queryFn: () => getCfbConferences(),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const slate = weekQuery.data;
  const shownWeek = week ?? slate?.week;
  const conferences = useMemo(
    () => [...(confQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [confQuery.data],
  );

  const games = useMemo(() => {
    const all = slate?.games ?? [];
    if (filter === "all") return all;
    if (filter === "top25") return all.filter((g) => g.home.rank || g.away.rank);
    return all.filter(
      (g) => g.home.team.conferenceId === filter || g.away.team.conferenceId === filter,
    );
  }, [slate, filter]);

  // Group by kickoff day, in order.
  const days = useMemo(() => {
    const map = new Map<string, typeof games>();
    for (const g of games) {
      const key = g.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [games]);

  const weeks = slate?.weeks ?? [];
  const idx = weeks.findIndex((w) => w.number === shownWeek);

  return (
    <>
      <PageTitle eyebrow={slate ? `FBS · ${slate.season}` : "FBS"} title="Games" />
      <Panel padded={false}>
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={idx <= 0}
                onClick={() => setWeek(weeks[idx - 1]?.number)}
                aria-label="Previous week"
                className="rounded px-2 text-mute hover:text-acc disabled:opacity-30"
              >
                ‹
              </button>
              <select
                value={shownWeek ?? ""}
                onChange={(e) => setWeek(Number(e.target.value))}
                aria-label="Week"
                className="rounded-md bg-panel2 px-2 py-1 font-disp text-xl uppercase ring-1 ring-line/10"
              >
                {weeks.map((w) => (
                  <option key={w.number} value={w.number}>
                    {w.label}
                    {w.number === slate?.currentWeek ? " (this week)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={idx < 0 || idx >= weeks.length - 1}
                onClick={() => setWeek(weeks[idx + 1]?.number)}
                aria-label="Next week"
                className="rounded px-2 text-mute hover:text-acc disabled:opacity-30"
              >
                ›
              </button>
            </span>
          }
          aside={
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter games"
              className="rounded-md bg-panel2 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-mute ring-1 ring-line/10"
            >
              <option value="all">All games</option>
              <option value="top25">Top 25</option>
              {conferences.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          }
        />
        {weekQuery.isLoading ? (
          <p className="py-10 text-center font-mono text-xs text-mute">Loading games…</p>
        ) : !slate ? (
          <p className="py-10 text-center font-mono text-xs text-mute">
            Games couldn&apos;t be loaded right now.
          </p>
        ) : games.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs text-mute">No games match.</p>
        ) : (
          <div className="space-y-5 p-4">
            {days.map(([day, list]) => (
              <section key={day}>
                <h3 suppressHydrationWarning className="label-mono mb-2">
                  {dayLabel(list[0].date)} · {list.length} game{list.length === 1 ? "" : "s"}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((g) => (
                    <CfbGameCard key={g.id} game={g} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
