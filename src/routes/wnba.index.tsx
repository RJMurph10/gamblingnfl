import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, StatCard } from "@/components/shared/booth";
import { WnbaLogo } from "@/components/wnba/WnbaBits";
import { WnbaLiveGames, WnbaRecentGames, WnbaUpcomingGames } from "@/components/wnba/WnbaDashTables";
import { buildWnbaStandings, hasScore, recordText } from "@/lib/wnba/wnba";
import { BEST_TOTAL_EDGE, gradeWnbaSeason, unitsText, winPct, type WnbaRecord } from "@/lib/wnba/wnba-model";
import { changeTone, weekChangeText } from "@/lib/shared/season-pulse";
import { useWnbaModel, useWnbaSchedule } from "@/lib/wnba/use-wnba";

export const Route = createFileRoute("/wnba/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingWNBA dashboard" },
      {
        name: "description",
        content:
          "WNBA dashboard: how the model's picks did against the closing lines, ★ best bets at the opening total, live and upcoming games, recent results and the standings.",
      },
    ],
  }),
  component: WnbaDashboard,
});

const rec = (r: WnbaRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");
const pctChange = (now: number | null, before: number | null) =>
  now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;

function WnbaDashboard() {
  const { games, teams, conferences, season, isLoading, isError } = useWnbaSchedule(60_000);
  const rows = useWnbaModel(games);
  const model = useMemo(() => new Map(rows.map((r) => [r.game.id, r])), [rows]);
  // upcoming and live ★ best bets, soonest first
  const bets = useMemo(
    () =>
      rows
        .filter((r) => r.best && (r.game.status === "scheduled" || r.game.status === "live"))
        .sort((a, b) => a.game.date.localeCompare(b.game.date))
        .slice(0, 12),
    [rows],
  );
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 3_600_000), []);
  const grade = useMemo(() => gradeWnbaSeason(rows), [rows]);
  const prev = useMemo(() => gradeWnbaSeason(rows, weekAgo), [rows, weekAgo]);
  const hasPrev = prev.moneyline.wins + prev.moneyline.losses > 0;

  const live = useMemo(() => games.filter((g) => g.status === "live"), [games]);
  const finals = useMemo(
    () =>
      games
        .filter((g) => g.status === "final" && hasScore(g))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [games],
  );
  const standings = useMemo(() => buildWnbaStandings(games.filter((g) => g.part === "reg"), [...teams.values()]), [games, teams]);
  // standings by conference: win %, then wins
  const confTables = useMemo(() => {
    const rows = [...standings.values()].filter((r) => r.overall.wins + r.overall.losses > 0);
    const pctOf = (r: (typeof rows)[number]) => r.overall.wins / Math.max(1, r.overall.wins + r.overall.losses);
    const byConf = [...conferences.values()].map((c) => ({
      conf: c,
      rows: rows.filter((r) => r.team.confId === c.id).sort((a, b) => pctOf(b) - pctOf(a) || b.overall.wins - a.overall.wins),
    }));
    return byConf.length && byConf.some((c) => c.rows.length)
      ? byConf
      : [{ conf: { id: "", name: "League", short: "League" }, rows: rows.sort((a, b) => pctOf(b) - pctOf(a)) }];
  }, [standings, conferences]);
  const winChange = hasPrev ? pctChange(winPct(grade.moneyline), winPct(prev.moneyline)) : null;
  const totalChange = hasPrev ? pctChange(winPct(grade.total), winPct(prev.total)) : null;
  const coverChange = hasPrev ? pctChange(winPct(grade.spread), winPct(prev.spread)) : null;
  const every = grade.moneyline.units + grade.spread.units + grade.total.units;
  const bestStakes = grade.best.wins + grade.best.losses + grade.best.pushes;
  const bestRoi = bestStakes ? (grade.best.units / bestStakes) * 100 : null;
  const bestChange = hasPrev ? Math.round((grade.best.units - prev.best.units) * 100) / 100 : null;
  const loading = isLoading ? "Loading…" : undefined;
  const through = finals[0]
    ? new Date(finals[0].date).toLocaleDateString([], { month: "short", day: "numeric" })
    : null;

  return (
    <>
      <section className="mb-6">
        <PageTitle
          eyebrow={games.length ? `Home dashboard · ${season || "2026"} season${games.some((g) => g.status !== "final") ? "" : " (final)"}` : "Home dashboard"}
          title="Season Pulse"
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Win rate · model"
            value={fmt(winPct(grade.moneyline))}
            unit={winPct(grade.moneyline) === null ? undefined : "%"}
            note={loading ?? note(weekChangeText(winChange, " pts"), grade.games ? `${rec(grade.moneyline)} picking winners` : "No games graded yet")}
            tone={changeTone(winChange)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(winPct(grade.total))}
            unit={winPct(grade.total) === null ? undefined : "%"}
            note={
              loading ??
              note(
                weekChangeText(totalChange, " pts"),
                grade.games ? `${rec(grade.total)} O/U at the opener` : "No games graded yet",
                grade.avgPoints !== null &&
                  grade.avgLine !== null &&
                  `games avg ${grade.avgPoints.toFixed(1)} vs line ${grade.avgLine.toFixed(1)}`,
              )
            }
            tone={changeTone(totalChange)}
          />
          <StatCard
            label="Cover % · model"
            value={fmt(winPct(grade.spread))}
            unit={winPct(grade.spread) === null ? undefined : "%"}
            note={loading ?? note(weekChangeText(coverChange, " pts"), grade.games ? `${rec(grade.spread)} ATS` : "No games graded yet")}
            tone={changeTone(coverChange)}
          />
          <StatCard
            label="Model edge · ★ best bets"
            value={unitsText(grade.best.units)}
            note={
              loading ??
              note(
                hasPrev && bestChange !== null
                  ? `${bestChange > 0 ? "▲" : bestChange < 0 ? "▼" : "—"} ${Math.abs(bestChange).toFixed(2)}u wk/wk`
                  : undefined,
                grade.best.wins + grade.best.losses
                  ? `${rec(grade.best)} · ROI ${bestRoi! > 0 ? "+" : ""}${bestRoi!.toFixed(1)}%`
                  : "No best bets graded yet",
                grade.games ? `every pick ${unitsText(every)}` : undefined,
              )
            }
            tone={grade.best.units > 0 ? "win" : grade.best.units < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {grade.games} games graded{through ? ` through ${through}` : ""} · flat 1u per pick at -110, totals and ★ at the opening total · picks made before tip-off from earlier games only ·{" "}
          <Link to="/wnba/model" className="text-acc">
            Model picks →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          <WnbaLiveGames games={live} model={model} />
          <WnbaUpcomingGames games={games} model={model} />
          <WnbaRecentGames
            model={model}
            games={finals.slice(0, 5)}
            emptyText={
              isLoading
                ? "Loading games from ESPN…"
                : isError
                  ? "Could not load games from ESPN. Try refreshing shortly."
                  : "No completed games yet."
            }
          />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              <span className="text-acc">★</span> Best bets
            </h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">
                Totals where the model is {BEST_TOTAL_EDGE}+ points off the opening total.
              </span>{" "}
              55-28, 55-32 and 54-45 in the three seasons with openers (61%; break-even 52.4%), once both teams have
              3+ games. Bet them early: at the closing total the same picks only hit about 50%.
            </p>
            <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
              {bets.length ? (
                bets.map((r) => (
                  <Link
                    key={r.game.id}
                    to="/wnba/games/$gameId"
                    params={{ gameId: r.game.id }}
                    className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] hover:bg-line/5"
                  >
                    <span className="text-acc">★</span>
                    <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
                      {r.game.away.team.abbr} @ {r.game.home.team.abbr} ·{" "}
                      {r.game.status === "live"
                        ? "live"
                        : new Date(r.game.date).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="font-semibold text-foreground">
                      {r.best!.pick === "over" ? "Over" : "Under"} {r.best!.line}
                    </span>
                    <span className="w-12 text-right text-mute">{r.pred.total.toFixed(1)}</span>
                  </Link>
                ))
              ) : (
                <p className="px-3 py-3 font-mono text-[11px] text-mute">
                  {isLoading ? "Loading…" : games.length && !games.some((g) => g.status !== "final") ? "The season is over. Best bets return in May." : "No best bets on the board right now. They show up once a game's opening total is posted."}
                </p>
              )}
            </div>
            <p className="mt-2 font-mono text-[10px] text-faint">
              Line shown is the opening total; the right column is the model's total. If the line has already moved
              toward the model, most of the edge is gone.
            </p>
            <Link to="/wnba/model" className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-acc">
              Full research →
            </Link>
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Standings</h2>
            <p className="label-mono mb-3">{season || "2026"} · tap a team</p>
            {confTables.some((c) => c.rows.length) ? (
              <div className="space-y-4">
                {confTables.map(({ conf, rows }) => (
                  <div key={conf.id || "all"}>
                    <p className="label-mono mb-1">{conf.short}</p>
                    <div className="divide-y divide-line/5 rounded-lg border border-line/10">
                      {rows.map((r, i) => (
                        <Link
                          key={r.teamId}
                          to="/wnba/teams/$teamId"
                          params={{ teamId: r.teamId }}
                          className="flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] hover:bg-line/5"
                        >
                          <span className="w-4 text-faint">{i + 1}</span>
                          <WnbaLogo team={r.team} className="size-5" />
                          <span className="min-w-0 flex-1 truncate font-sans text-sm">{r.team.short}</span>
                          <span className="tabular-nums text-foreground">{recordText(r.overall)}</span>
                          <span className="w-8 text-right text-mute">{r.streak}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center font-mono text-xs text-mute">{isLoading ? "Loading standings…" : "No games yet."}</p>
            )}
            <Link to="/wnba/teams" className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc">
              + all teams
            </Link>
          </Panel>
        </aside>
      </div>
    </>
  );
}
