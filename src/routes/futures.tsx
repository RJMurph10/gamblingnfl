import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Panel, TeamLogo } from "@/components/shared/booth";
import type { Game } from "@/data/shared/games";
import { divisions, teamById } from "@/data/shared/teams";
import { getLiveSchedule } from "@/lib/shared/espn.functions";
import { getNflHistory } from "@/lib/shared/history.functions";
import { qbStartsFrom, readHistory } from "@/lib/nfl/model-history";
import { fairOdds, nflFutures, type TeamFutures } from "@/lib/nfl/futures-sim";

export const Route = createFileRoute("/futures")({
  head: () => ({
    meta: [
      { title: "Futures — GamblingNFL" },
      {
        name: "description",
        content:
          "NFL futures from 10,000 simulated seasons: every team's chance to win its division, make the playoffs, get the 1 seed and bye, and win the conference and Super Bowl, with fair odds.",
      },
      { property: "og:title", content: "Futures — GamblingNFL" },
      {
        property: "og:description",
        content: "Division, playoff, bye, conference and Super Bowl odds from simulated seasons.",
      },
    ],
  }),
  component: FuturesPage,
});

const SIMS = 10_000;

type Market = "division" | "playoffs" | "topSeed" | "conference" | "superBowl";
const MARKETS: { key: Market; label: string; short: string }[] = [
  { key: "division", label: "Win division", short: "Div" },
  { key: "playoffs", label: "Make playoffs", short: "Playoffs" },
  { key: "topSeed", label: "1 seed (bye)", short: "1 seed" },
  { key: "conference", label: "Win conference", short: "Conf" },
  { key: "superBowl", label: "Win Super Bowl", short: "SB" },
];

function pctText(p: number) {
  if (p >= 0.995 && p < 1) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

function Cell({ p, mode }: { p: number; mode: "pct" | "odds" }) {
  const shade = Math.round(Math.min(1, p) * 28);
  return (
    <td
      className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums"
      style={{ backgroundColor: p > 0 ? `color-mix(in oklab, var(--acc) ${shade}%, transparent)` : undefined }}
    >
      {p === 0 ? <span className="text-faint">—</span> : mode === "pct" ? pctText(p) : fairOdds(p)}
    </td>
  );
}

function FuturesPage() {
  const scheduleQuery = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: 1,
  });
  const games: Game[] = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  // Starting quarterbacks (finished games and next week's projected starters) for the QB ratings.
  const historyQuery = useQuery({
    queryKey: ["nfl-history-v2"],
    queryFn: () => getNflHistory(),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const qb = useMemo(() => {
    const h = readHistory(historyQuery.data);
    if (!h.currentSeason || !h.games.length) return undefined;
    return { season: h.currentSeason, starts: qbStartsFrom(h.games), upcoming: h.upcoming };
  }, [historyQuery.data]);
  // Only re-simulate when a result or a line changes, not on every schedule refresh.
  const finalsKey = useMemo(
    () => games.map((g) => `${g.id}:${g.status === "final" ? "f" : ""}:${g.spread ?? ""}`).join(","),
    [games],
  );
  const [results, setResults] = useState<TeamFutures[]>([]);
  useEffect(() => {
    if (!games.length || historyQuery.isLoading) return;
    // let the page paint first: 10,000 seasons take most of a second
    const t = setTimeout(() => setResults(nflFutures(games, SIMS, qb)), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalsKey, qb, historyQuery.isLoading]);

  const [mode, setMode] = useState<"pct" | "odds">("pct");
  const byId = useMemo(() => new Map(results.map((r) => [r.id, r])), [results]);
  const remaining = games.filter((g) => g.status !== "final").length;
  const nextWeek = useMemo(() => {
    const open = games.filter((g) => g.status !== "final").map((g) => g.week);
    return open.length ? Math.min(...open) : null;
  }, [games]);
  const sbBoard = useMemo(
    () => [...results].sort((a, b) => b.superBowl - a.superBowl).slice(0, 10),
    [results],
  );

  return (
    <>
      <PageTitle
        eyebrow={`NFL futures · ${SIMS.toLocaleString()} simulated seasons${nextWeek ? ` · from week ${nextWeek}` : ""}`}
        title="Futures"
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line/10 p-0.5 font-mono text-[11px]">
          {(
            [
              ["pct", "Chance"],
              ["odds", "Fair odds"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`rounded-md px-3 py-1 ${mode === k ? "bg-acc/15 text-acc" : "text-mute"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[10px] text-faint">
          {mode === "odds"
            ? "Fair odds = the price with no house cut. A bet is worth it only when a sportsbook pays more than this."
            : `${remaining} games left to simulate · re-run after every final score`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          {(["AFC", "NFC"] as const).map((conf) => (
            <Panel key={conf}>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">{conf}</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-2 py-1 text-left">Team</th>
                      <th className="px-2 py-1 text-right">Record</th>
                      <th className="px-2 py-1 text-right">Proj W</th>
                      {MARKETS.map((m) => (
                        <th key={m.key} className="px-2 py-1 text-right" title={m.label}>
                          {m.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {divisions
                    .filter((d) => d.conference === conf)
                    .map(({ division }) => {
                      const rows = results
                        .filter((r) => {
                          const t = teamById(r.id);
                          return t?.conference === conf && t.division === division;
                        })
                        .sort((a, b) => b.division - a.division || b.projWins - a.projWins);
                      return (
                        <tbody key={division} className="border-t border-line/10">
                          <tr>
                            <td colSpan={3 + MARKETS.length} className="px-2 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wider text-mute">
                              {conf} {division}
                            </td>
                          </tr>
                          {rows.map((r) => {
                            const team = teamById(r.id)!;
                            return (
                              <tr key={r.id} className="hover:bg-line/5">
                                <td className="px-2 py-1.5">
                                  <Link
                                    to="/teams/$teamId"
                                    params={{ teamId: team.id }}
                                    className="flex items-center gap-2 text-sm font-semibold"
                                  >
                                    <TeamLogo team={team} className="size-5" />
                                    {team.abbr}
                                  </Link>
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-[11px] text-mute">
                                  {r.wins % 1 ? `${Math.floor(r.wins)}-${Math.floor(r.losses)}-1` : `${r.wins}-${r.losses}`}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-[11px]">{r.projWins.toFixed(1)}</td>
                                {MARKETS.map((m) => (
                                  <Cell key={m.key} p={r[m.key]} mode={mode} />
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                </table>
                {!results.length && (
                  <p className="py-6 text-center font-mono text-xs text-mute">
                    {scheduleQuery.isError ? "Could not load the schedule from ESPN. Try refreshing shortly." : "Simulating the season…"}
                  </p>
                )}
              </div>
            </Panel>
          ))}
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Super Bowl odds</h2>
            <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
              {sbBoard.map((r, i) => {
                const team = byId.has(r.id) ? teamById(r.id)! : null;
                if (!team) return null;
                return (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 font-mono text-[11px]">
                    <span className="w-4 text-faint">{i + 1}</span>
                    <TeamLogo team={team} className="size-5" />
                    <span className="flex-1 font-semibold text-foreground">{team.abbr}</span>
                    <span className="w-12 text-right">{pctText(r.superBowl)}</span>
                    <span className="w-14 text-right text-mute">{fairOdds(r.superBowl)}</span>
                  </div>
                );
              })}
              {!sbBoard.length && <p className="px-3 py-3 font-mono text-[11px] text-mute">Simulating…</p>}
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">Chance and fair odds (no house cut).</p>
          </Panel>
          <Panel>
            <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">How it works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
              <li>
                Plays the rest of the regular season {SIMS.toLocaleString()} times. Team strength comes from
                the betting spreads: every spread posted so far this season (recent weeks count more),
                starting from 60% of each team&apos;s final market rating last season. Spreads already
                include injuries, quarterback changes and everything else the books know.
              </li>
              <li>
                Quarterbacks: next week&apos;s line already prices whoever starts. When a fill-in is
                starting (an injured starter), his gap to the regular starter, from the site&apos;s
                quarterback ratings, also counts for the two weeks after. Tested on 24 seasons: longer
                stretches, or correcting past spreads for fill-in starts, didn&apos;t sharpen the odds,
                because the weekly spreads already move with every quarterback change.
              </li>
              <li>
                Each simulated season also nudges every team&apos;s true strength up or down a little (about
                2 points), because a rating is an estimate: a team that is really better wins more of all its
                remaining games.
              </li>
              <li>
                Seeds each conference with the NFL&apos;s rules: division winners are seeds 1–4, three wild
                cards are 5–7, and only the 1 seed gets a bye. Ties are broken in the NFL&apos;s order
                (head-to-head, division record, common games, conference record, strength of victory and of
                schedule). Then it plays the playoffs: after the first round, the top seed left hosts the
                lowest.
              </li>
              <li>
                Tuned on past seasons: every season from 2002 to 2025 was replayed from the preseason and
                after weeks 4, 8 and 12. Settings were picked on 2002–2013 and checked on 2014–2025, which
                the choice never saw. Spread-based strength beat strength from scores at every stop, most
                of all in the preseason and early season. The seeding code picked the real playoff field
                in all 24 seasons.
              </li>
              <li>
                Not a ★ pick: there is no free history of futures prices to test against yet. Compare the fair
                odds with your sportsbook, and bet only when it pays more.
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
