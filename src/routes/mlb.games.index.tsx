import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { MlbEmpty, MlbLogo } from "@/components/mlb/MlbBits";
import { americanText, hasScore, statusText, type MlbGame } from "@/lib/mlb/mlb";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/games/")({
  head: () => ({
    meta: [
      { title: "Games — GamblingMLB" },
      {
        name: "description",
        content:
          "Every MLB game this season: upcoming and live games, and final scores with the closing lines.",
      },
    ],
  }),
  component: MlbGamesPage,
});

const PAGE = 30;

function MlbGamesPage() {
  const { games, isLoading } = useMlbSchedule(60_000);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [shown, setShown] = useState(PAGE);
  const upcoming = useMemo(
    () =>
      games
        .filter((g) => g.status === "scheduled" || g.status === "live")
        .sort((a, b) => a.date.localeCompare(b.date)),
    [games],
  );
  const results = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [games],
  );
  const active = tab === "upcoming" && !upcoming.length && results.length ? "results" : tab;
  const list = active === "upcoming" ? upcoming : results;
  return (
    <>
      <PageTitle eyebrow="MLB" title="Games" />
      {isLoading ? (
        <MlbEmpty>Loading the schedule…</MlbEmpty>
      ) : (
        <Panel padded={false}>
          <PanelHeader
            title={active === "upcoming" ? "Upcoming & live" : "Results"}
            aside={
              <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                {list.length} games
              </span>
            }
          />
          <div className="flex gap-2 px-4 py-3" role="tablist" aria-label="Games">
            {(
              [
                ["upcoming", `Upcoming${upcoming.length ? "" : " (none)"}`],
                ["results", "Results"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                onClick={() => {
                  setTab(key);
                  setShown(PAGE);
                }}
                className={`shrink-0 rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${active === key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-line/5">
            {list.slice(0, shown).map((g) => (
              <Row key={g.id} game={g} />
            ))}
          </ul>
          {list.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="w-full py-3 font-mono text-[11px] uppercase tracking-wider text-acc"
            >
              Show more
            </button>
          ) : null}
        </Panel>
      )}
    </>
  );
}

function Row({ game }: { game: MlbGame }) {
  const final = game.status === "final";
  const o = game.odds;
  const ou =
    final && o?.total != null && hasScore(game)
      ? (game.away.score as number) + (game.home.score as number) > o.total
        ? "O"
        : (game.away.score as number) + (game.home.score as number) < o.total
          ? "U"
          : "P"
      : null;
  return (
    <li>
      <Link
        to="/mlb/games/$gameId"
        params={{ gameId: game.id }}
        className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-line/5"
      >
        <span
          className={`w-36 shrink-0 font-mono text-[10px] uppercase tracking-wider ${game.status === "live" ? "text-win" : "text-mute"}`}
          suppressHydrationWarning
        >
          {final
            ? new Date(game.date).toLocaleDateString([], { month: "short", day: "numeric" }) +
              " · " +
              statusText(game)
            : statusText(game)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <MlbLogo team={game.away.team} className="size-5" />
          <span className="font-medium">{game.away.team.abbr}</span>
          <span className="font-mono tabular-nums">
            {final || game.status === "live" ? game.away.score : ""}
          </span>
          <span className="text-faint">@</span>
          <MlbLogo team={game.home.team} className="size-5" />
          <span className="font-medium">{game.home.team.abbr}</span>
          <span className="font-mono tabular-nums">
            {final || game.status === "live" ? game.home.score : ""}
          </span>
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] text-mute sm:inline">
          {americanText(o?.mlAway)} / {americanText(o?.mlHome)} · O/U {o?.total ?? "—"}
          {ou ? ` · ${ou}` : ""}
        </span>
      </Link>
    </li>
  );
}
