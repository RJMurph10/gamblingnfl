import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { Chip, EmptyPanel, NbaLogo } from "@/components/nba/NbaBits";
import { etDayKey, etDayLabel, hasScore, pct, spreadText, type NbaTeamRef } from "@/lib/nba";
import {
  buildRatings,
  ratingRows,
  summarizeNba,
  unitsText,
  type NbaModelRow,
  type Record3,
} from "@/lib/nba-model";
import { useNbaModelRows, useNbaPrior, useNbaSchedule, useNbaStandings } from "@/lib/use-nba";

export const Route = createFileRoute("/nba/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingNBA" },
      {
        name: "description",
        content: "The NBA model: power ratings, today's picks against the lines, and a graded record of every pick.",
      },
    ],
  }),
  component: NbaModelPage,
});

const rec = (r: Record3) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const resultClass = (r: string | null | undefined) => (r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute");

function PickCells({ row }: { row: NbaModelRow }) {
  const { game } = row;
  const side = (p: "home" | "away") => (p === "home" ? game.home.team.abbr : game.away.team.abbr);
  return (
    <>
      <td className={`px-2 py-2.5 font-mono text-[12px] ${resultClass(row.moneyline.result)}`}>
        {side(row.moneyline.pick)} <span className="text-faint">{pct(row.moneyline.prob, 0)}</span>
      </td>
      <td className={`px-2 py-2.5 font-mono text-[12px] ${resultClass(row.spread?.result)}`}>
        {row.spread ? (
          <>
            {row.spread.best ? "★ " : ""}
            {side(row.spread.pick)} {spreadText(game, row.spread.line)}
            <span className="ml-1 text-faint">+{row.spread.edge.toFixed(1)}</span>
          </>
        ) : (
          <span className="text-faint">{game.odds?.spread != null ? "pass" : "no line"}</span>
        )}
      </td>
      <td className={`px-2 py-2.5 font-mono text-[12px] ${resultClass(row.total?.result)}`}>
        {row.total ? (
          <>
            {row.total.best ? "★ " : ""}
            {row.total.pick} {row.total.line}
            <span className="ml-1 text-faint">+{row.total.edge.toFixed(1)}</span>
          </>
        ) : (
          <span className="text-faint">{game.odds?.total ? "pass" : "no line"}</span>
        )}
      </td>
    </>
  );
}

function PicksTable({ rows, empty, graded }: { rows: NbaModelRow[]; empty: string; graded?: boolean }) {
  if (!rows.length) return <p className="px-4 py-8 text-center font-mono text-xs text-mute">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Game</th>
            <th className="px-2 py-2 font-normal">Proj</th>
            <th className="px-2 py-2 font-normal">Winner</th>
            <th className="px-2 py-2 font-normal">Spread</th>
            <th className="px-2 py-2 font-normal">Total</th>
            {graded ? <th className="px-4 py-2 text-right font-normal">Final</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {rows.map((row) => (
            <tr key={row.game.id} className="hover:bg-line/5">
              <td className="px-4 py-2.5">
                <Link to="/nba/games/$gameId" params={{ gameId: row.game.id }} className="inline-flex items-center gap-2 hover:text-acc">
                  <NbaLogo team={row.game.away.team} className="size-5" />
                  <span className="font-medium">{row.game.away.team.abbr}</span>
                  <span className="text-faint">@</span>
                  <NbaLogo team={row.game.home.team} className="size-5" />
                  <span className="font-medium">{row.game.home.team.abbr}</span>
                </Link>
              </td>
              <td className="px-2 py-2.5 font-mono text-[12px] tabular-nums text-mute">
                {row.pred.away.toFixed(0)}–{row.pred.home.toFixed(0)}
              </td>
              <PickCells row={row} />
              {graded ? (
                <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-mute">
                  {hasScore(row.game) ? `${row.game.away.score}–${row.game.home.score}` : ""}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NbaModelPage() {
  const { games, isLoading } = useNbaSchedule(60_000);
  const prior = useNbaPrior();
  const standings = useNbaStandings();
  const rows = useNbaModelRows(games);
  const [scope, setScope] = useState<"bets" | "predictions">("bets");
  const [historyLimit, setHistoryLimit] = useState(25);

  const summary = useMemo(() => summarizeNba(rows, scope), [rows, scope]);
  const upcoming = useMemo(() => rows.filter((r) => r.game.status !== "final").filter((r) => etDayKey(r.game.date) >= etDayKey(new Date()) || r.game.status === "live"), [rows]);
  const upcomingDays = useMemo(() => {
    const map = new Map<string, NbaModelRow[]>();
    for (const r of upcoming) {
      const k = etDayKey(r.game.date);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 4);
  }, [upcoming]);
  const history = useMemo(
    () => rows.filter((r) => r.game.status === "final").sort((a, b) => b.game.date.localeCompare(a.game.date)),
    [rows],
  );

  const power = useMemo(() => {
    const finals = games.filter((g) => g.status === "final" && g.part !== "pre" && hasScore(g));
    const teamsById = new Map<string, NbaTeamRef>();
    for (const g of games) {
      teamsById.set(g.home.team.id, g.home.team);
      teamsById.set(g.away.team.id, g.away.team);
    }
    for (const s of standings.rows) teamsById.set(s.teamId, s.team);
    return ratingRows(buildRatings(finals, prior))
      .map((r) => ({ ...r, team: teamsById.get(r.teamId) }))
      .filter((r): r is typeof r & { team: NbaTeamRef } => Boolean(r.team));
  }, [games, prior, standings.rows]);

  const label = scope === "bets" ? "★ best bets" : "every pick";
  return (
    <>
      <PageTitle
        eyebrow="Model · picks vs. closing lines"
        title="Model"
        aside={
          <div className="flex gap-2">
            <Chip active={scope === "bets"} onClick={() => setScope("bets")}>★ Best bets</Chip>
            <Chip active={scope === "predictions"} onClick={() => setScope("predictions")}>Every pick</Chip>
          </div>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Units · ${label}`} value={unitsText(summary.overall.units)} note={summary.overall.roi === null ? "Nothing graded yet" : `${rec(summary.overall)} · ROI ${summary.overall.roi > 0 ? "+" : ""}${summary.overall.roi.toFixed(1)}%`} tone={summary.overall.units > 0 ? "win" : summary.overall.units < 0 ? "loss" : "mute"} />
        <StatCard label="Spread (ATS)" value={summary.spread.winPct === null ? "—" : summary.spread.winPct.toFixed(1)} unit={summary.spread.winPct === null ? undefined : "%"} note={`${rec(summary.spread)} · ${unitsText(summary.spread.units)}`} />
        <StatCard label="Totals (O/U)" value={summary.total.winPct === null ? "—" : summary.total.winPct.toFixed(1)} unit={summary.total.winPct === null ? undefined : "%"} note={`${rec(summary.total)} · ${unitsText(summary.total.units)}`} />
        <StatCard label="Straight-up winners" value={scope === "predictions" ? (summary.moneyline.winPct === null ? "—" : summary.moneyline.winPct.toFixed(1)) : "—"} unit={scope === "predictions" && summary.moneyline.winPct !== null ? "%" : undefined} note={scope === "predictions" ? `${rec(summary.moneyline)} picking winners` : "switch to Every pick"} />
      </div>
      <p className="mb-6 font-mono text-[10px] uppercase tracking-wider text-faint">
        ★ = model is {`≥`}3 pts off the spread or {`≥`}5 off the total · flat 1u at -110 · every finished game is predicted using only games before its day · preseason excluded
      </p>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {upcomingDays.length ? (
            upcomingDays.map(([day, list]) => (
              <Panel key={day} padded={false}>
                <PanelHeader title={etDayLabel(day)} aside={<span className="label-mono">{list.length} {list.length === 1 ? "game" : "games"}</span>} />
                <PicksTable rows={list} empty="" />
              </Panel>
            ))
          ) : (
            <EmptyPanel>{isLoading ? "Loading games from ESPN…" : "No upcoming games to pick yet."}</EmptyPanel>
          )}
          <Panel padded={false}>
            <PanelHeader title="Graded picks" aside={<span className="label-mono">{history.length} games</span>} />
            <PicksTable rows={history.slice(0, historyLimit)} empty="No games have finished yet." graded />
            {history.length > historyLimit ? (
              <button onClick={() => setHistoryLimit((n) => n + 40)} className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5">
                Show more ({history.length - historyLimit} remaining)
              </button>
            ) : null}
          </Panel>
        </div>

        <aside className="min-w-0 lg:col-span-4">
          <Panel padded={false}>
            <PanelHeader title="Power ratings" aside={<span className="label-mono">pts / game</span>} />
            {power.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">#</th>
                      <th className="px-2 py-2 font-normal">Team</th>
                      <th className="px-2 py-2 text-right font-normal" title="Points scored vs. an average defense">OFF</th>
                      <th className="px-2 py-2 text-right font-normal" title="Points allowed vs. an average offense">DEF</th>
                      <th className="px-4 py-2 text-right font-normal">NET</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {power.map((r) => (
                      <tr key={r.teamId} className="hover:bg-line/5">
                        <td className="px-4 py-2 font-mono text-[11px] text-faint">{r.rank}</td>
                        <td className="px-2 py-2">
                          <Link to="/nba/teams/$teamId" params={{ teamId: r.teamId }} className="inline-flex items-center gap-2 hover:text-acc">
                            <NbaLogo team={r.team} className="size-5" />
                            <span className="font-medium">{r.team.abbr}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{r.offense.toFixed(1)}</td>
                        <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{r.defense.toFixed(1)}</td>
                        <td className={`px-4 py-2 text-right font-mono text-[12px] tabular-nums ${r.net > 0 ? "text-win" : r.net < 0 ? "text-loss" : ""}`}>
                          {r.net > 0 ? "+" : ""}{r.net.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center font-mono text-xs text-mute">{isLoading ? "Loading…" : "Ratings appear once ESPN's data loads."}</p>
            )}
            <p className="border-t border-line/10 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-faint">
              Starts from last season&apos;s scoring, then moves toward this season&apos;s results as games are played. Net = OFF − DEF.
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
