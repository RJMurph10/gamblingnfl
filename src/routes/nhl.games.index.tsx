import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { NhlEmpty } from "@/components/nhl/NhlBits";
import { NhlGameTable } from "@/components/nhl/NhlTables";
import { hasScore } from "@/lib/nhl/nhl";
import { useNhlSchedule } from "@/lib/nhl/use-nhl";

export const Route = createFileRoute("/nhl/games/")({
  head: () => ({
    meta: [
      { title: "Games — GamblingNHL" },
      { name: "description", content: "Every NHL game this season: upcoming and live games, and final scores with the closing lines." },
    ],
  }),
  component: NhlGamesPage,
});

const PAGE = 25;

function NhlGamesPage() {
  const { games, isLoading, isError } = useNhlSchedule(60_000);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [shown, setShown] = useState(PAGE);

  const upcoming = useMemo(
    () =>
      games
        .filter((g) => (g.status === "scheduled" || g.status === "live") && g.part !== "pre")
        .sort((a, b) => a.date.localeCompare(b.date)),
    [games],
  );
  const results = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g) && g.part !== "pre")
        .sort((a, b) => b.date.localeCompare(a.date)),
    [games],
  );
  const list = tab === "upcoming" ? upcoming : results;

  const pick = (next: "upcoming" | "results") => {
    setTab(next);
    setShown(PAGE);
  };

  return (
    <>
      <PageTitle eyebrow="NHL" title="Games" />
      {isLoading ? (
        <NhlEmpty>Loading the schedule…</NhlEmpty>
      ) : (
        <Panel padded={false}>
          <PanelHeader
            title={tab === "upcoming" ? "Upcoming & live" : "Results"}
            aside={
              <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                {list.length} {list.length === 1 ? "game" : "games"}
              </span>
            }
          />
          <div className="flex gap-2 px-4 py-3" role="tablist" aria-label="Games">
            {(
              [
                ["upcoming", "Upcoming"],
                ["results", "Results"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => pick(key)}
                className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${tab === key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <NhlGameTable
            games={list.slice(0, shown)}
            emptyText={
              isError
                ? "Could not load games from ESPN. Try refreshing shortly."
                : tab === "upcoming"
                  ? "No upcoming games scheduled"
                  : "No completed NHL games are currently available from ESPN."
            }
          />
          {list.length > shown ? (
            <div className="px-4 py-3 text-center">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="rounded-full bg-panel2 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mute ring-1 ring-line/10 hover:text-acc"
              >
                Show more ({list.length - shown} left)
              </button>
            </div>
          ) : null}
        </Panel>
      )}
    </>
  );
}
