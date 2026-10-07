import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { players, positionGroup, positions, type Position } from "@/data/players";
import { teamById } from "@/data/teams";

export const Route = createFileRoute("/players/")({
  head: () => ({
    meta: [
      { title: "Player Search — GamblingNFL" },
      {
        name: "description",
        content:
          "Search NFL players by name or team and filter by position to open per-player analytics and prop projections.",
      },
      { property: "og:title", content: "Player Search — GamblingNFL" },
      {
        property: "og:description",
        content: "Searchable player index with season volume, touchdowns, and usage share.",
      },
    ],
  }),
  component: PlayersPage,
});

function PlayersPage() {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => (position === "ALL" ? true : positionGroup(p.position) === position))
      .filter((p) => {
        if (!q) return true;
        const team = teamById(p.teamId);
        return (
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
          (team ? `${team.city} ${team.name} ${team.abbr}`.toLowerCase().includes(q) : false)
        );
      })
      .sort((a, b) => b.season.yards - a.season.yards || b.season.touches - a.season.touches);
  }, [query, position]);

  const max = filtered[0]?.season.yards || 1;
  const [limit, setLimit] = useState(150);

  return (
    <>
      <PageTitle eyebrow="Player index" title="Players" aside={<span className="label-mono">{players.length} players · ESPN 2026</span>} />
      <Panel padded={false}>
        <PanelHeader
          title="Search"
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="rounded-lg bg-panel2 px-3 py-1.5 text-sm text-ink ring-1 ring-line/10 outline-none placeholder:text-faint focus:ring-acc/40"
                placeholder="Search players or teams…"
                aria-label="Search players"
              />
              {(["ALL", ...positions] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosition(pos)}
                  className={`rounded-lg px-3 py-1.5 font-mono text-[11px] ring-1 ${
                    position === pos
                      ? "bg-acc/10 text-acc ring-acc/25"
                      : "bg-panel2 text-mute ring-line/10"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Team</th>
                <th className="px-2 py-2 font-normal">Player</th>
                <th className="px-2 py-2 text-right font-normal">G</th>
                <th className="px-2 py-2 text-right font-normal">Yds</th>
                <th className="px-2 py-2 text-right font-normal">TD</th>
                <th className="px-2 py-2 text-right font-normal">Y/G</th>
                <th className="px-4 py-2 font-normal">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {filtered.slice(0, limit).map((p) => {
                const team = teamById(p.teamId);
                return (
                  <tr key={p.id} className="hover:bg-line/5">
                    <td className="px-4 py-2.5">
                      <Link
                        to="/players/$playerId"
                        params={{ playerId: p.id }}
                        className="font-medium hover:text-acc"
                      >
                        {p.firstName} {p.lastName}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-mute">{p.position}</td>
                    <td className="px-2 py-2.5 font-mono text-mute">
                      {team ? (
                        <Link to="/teams/$teamId" params={{ teamId: team.id }} className="hover:text-acc">
                          {team.abbr}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{p.season.games}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      {p.season.yards.toLocaleString()}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{p.season.tds}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      {(p.season.yards / Math.max(1, p.season.games)).toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-1.5 w-24 rounded-full bg-panel2">
                        <div
                          className="h-1.5 rounded-full bg-acc"
                          style={{ width: `${Math.round((p.season.yards / max) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > limit ? (
          <button onClick={() => setLimit((l) => l + 150)} className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5">
            Show more ({filtered.length - limit} remaining)
          </button>
        ) : null}
        {filtered.length === 0 ? (
          <p className="px-4 py-6 font-mono text-[11px] uppercase tracking-wider text-faint">
            No players match that search.
          </p>
        ) : null}
      </Panel>
    </>
  );
}
