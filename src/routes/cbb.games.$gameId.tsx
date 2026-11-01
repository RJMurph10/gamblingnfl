import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbbEmpty, CbbLogo } from "@/components/cbb/CbbBits";
import {
  americanText,
  atsResult,
  etDayKey,
  etDayLabel,
  hasScore,
  localTip,
  ouResult,
  periodLabel,
  spreadText,
  statusText,
  type CbbBoxTeam,
  type CbbGame,
  type CbbSide,
} from "@/lib/cbb/cbb";
import { useCbbGameDetail, useCbbModel, useCbbSchedule } from "@/lib/cbb/use-cbb";

export const Route = createFileRoute("/cbb/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingCBB" }] }),
  component: CbbGamePage,
});

function CbbGamePage() {
  const { gameId } = Route.useParams();
  const schedule = useCbbSchedule(false);
  const fromSchedule = schedule.games.find((g) => g.id === gameId);
  const detail = useCbbGameDetail(gameId, fromSchedule?.status === "live" || fromSchedule === undefined);
  const rows = useCbbModel(schedule.games);
  const row = rows.find((r) => r.game.id === gameId);

  const game: CbbGame | undefined = useMemo(() => {
    const d = detail.data?.game;
    if (!d) return fromSchedule;
    if (!fromSchedule) return d;
    // the schedule's team details (ranks, conference) and stored closing line fill gaps in ESPN's summary
    return {
      ...d,
      away: { ...d.away, rank: d.away.rank ?? fromSchedule.away.rank, team: { ...fromSchedule.away.team, ...d.away.team, confId: fromSchedule.away.team.confId } },
      home: { ...d.home, rank: d.home.rank ?? fromSchedule.home.rank, team: { ...fromSchedule.home.team, ...d.home.team, confId: fromSchedule.home.team.confId } },
      odds: d.odds?.spread != null || !fromSchedule.odds ? d.odds : { ...fromSchedule.odds, ...Object.fromEntries(Object.entries(d.odds ?? {}).filter(([, v]) => v != null)) },
    };
  }, [detail.data, fromSchedule]);

  if (!game) {
    return (
      <>
        <PageTitle eyebrow="Men's college basketball" title="Game" />
        <CbbEmpty>
          {detail.isLoading || schedule.isLoading ? "Loading game…" : "That game wasn't found."}{" "}
          <Link to="/cbb/games" className="text-acc">
            All games →
          </Link>
        </CbbEmpty>
      </>
    );
  }

  const started = game.status === "live" || game.status === "final";
  const o = game.odds;
  const ats = atsResult(game);
  const ou = ouResult(game);
  const winProb = detail.data?.winProb ?? [];
  const lastProb = winProb[winProb.length - 1];

  return (
    <>
      <PageTitle
        eyebrow={`Men's college basketball · ${etDayLabel(etDayKey(game.date))}${game.note ? ` · ${game.note}` : ""}`}
        title={`${game.away.team.short} at ${game.home.team.short}`}
      />
      <div className="space-y-6">
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <TeamBlock side={game.away} winner={game.status === "final" && hasScore(game) && (game.away.score as number) > (game.home.score as number)} started={started} />
            <div className="shrink-0 text-center">
              <p className={`font-mono text-xs uppercase tracking-wider ${game.status === "live" ? "text-win" : "text-mute"}`} suppressHydrationWarning>
                {game.status === "scheduled" ? localTip(game.date) : statusText(game)}
              </p>
              <p className="mt-1 font-mono text-[10px] text-faint">{[game.venue, game.broadcast].filter(Boolean).join(" · ")}</p>
              {game.neutral ? <p className="font-mono text-[10px] text-faint">Neutral site</p> : null}
            </div>
            <TeamBlock side={game.home} winner={game.status === "final" && hasScore(game) && (game.home.score as number) > (game.away.score as number)} started={started} right />
          </div>
          {started && (game.away.periods.length || game.home.periods.length) ? <LineScore game={game} /> : null}
        </Panel>

        <div className="grid gap-6 md:grid-cols-2">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Lines</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-sm">
              <Line label="Spread" value={spreadText(game, o?.spread)} sub={ats ? (ats === "push" ? "push" : `${(ats === "home" ? game.home : game.away).team.abbr} covered`) : o?.spreadOddsHome != null ? `${americanText(o.spreadOddsAway)} / ${americanText(o.spreadOddsHome)}` : undefined} />
              <Line label="Total" value={o?.total != null ? String(o.total) : "—"} sub={ou ? (ou === "push" ? "push" : `${ou} (${(game.home.score as number) + (game.away.score as number)})`) : o?.overOdds != null ? `o ${americanText(o.overOdds)} / u ${americanText(o.underOdds)}` : undefined} />
              <Line label="Moneyline" value={`${americanText(o?.mlAway)} / ${americanText(o?.mlHome)}`} sub={`${game.away.team.abbr} / ${game.home.team.abbr}`} />
            </dl>
            <p className="mt-3 font-mono text-[10px] text-faint">
              {game.status === "final" ? "Closing lines" : "Current lines"}
              {o?.provider ? ` · ${o.provider}` : ""} · from ESPN
            </p>
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
            {row ? (
              <>
                <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-sm">
                  <Line
                    label="Projected score"
                    value={`${Math.round(row.pred.away)}–${Math.round(row.pred.home)}`}
                    sub={`${game.away.team.abbr}–${game.home.team.abbr}`}
                  />
                  <Line
                    label="Win chance"
                    value={`${Math.round(row.moneyline.prob * 100)}%`}
                    sub={`${(row.moneyline.pick === "home" ? game.home : game.away).team.abbr}${row.moneyline.result ? ` · ${row.moneyline.result}` : ""}`}
                  />
                  <Line
                    label="Picks"
                    value={
                      [
                        row.spread ? `${(row.spread.pick === "home" ? game.home : game.away).team.abbr} ATS` : null,
                        row.total ? (row.total.pick === "over" ? "Over" : "Under") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No pick"
                    }
                    sub={
                      [row.spread?.result, row.total?.result].some(Boolean)
                        ? [row.spread?.result && `spread ${row.spread.result}`, row.total?.result && `total ${row.total.result}`].filter(Boolean).join(" · ")
                        : row.spread || row.total
                          ? `edge ${[row.spread && `${row.spread.edge.toFixed(1)} pts`, row.total && `${row.total.edge.toFixed(1)} pts`].filter(Boolean).join(" / ")}`
                          : "within 2 pts of the spread, 3 of the total"
                    }
                  />
                </dl>
                <p className="mt-3 font-mono text-[10px] text-faint">
                  {game.status === "final" ? "Made from games before this one only. " : ""}Tracking only: the model hasn't beaten college
                  closing lines in testing.{" "}
                  <Link to="/cbb/model" className="text-acc">
                    Why →
                  </Link>
                </p>
              </>
            ) : (
              <p className="mt-3 font-mono text-xs text-mute">{schedule.isLoading ? "Loading…" : "No projection for this game."}</p>
            )}
            {game.status === "live" && lastProb != null ? (
              <p className="mt-2 font-mono text-xs">
                ESPN live win chance: {game.home.team.abbr} {Math.round(lastProb * 100)}%
              </p>
            ) : null}
          </Panel>
        </div>

        {detail.data?.teamStats.length ? <TeamStats game={game} stats={detail.data.teamStats} /> : null}
        {detail.data?.box.map((b) => <BoxScore key={b.teamId} box={b} game={game} />)}
        {detail.data?.plays.length ? <Plays game={game} /> : null}
        {!started ? (
          <p className="font-mono text-[11px] text-mute">Box score and play-by-play appear once the game tips off.</p>
        ) : detail.isLoading ? (
          <CbbEmpty>Loading box score…</CbbEmpty>
        ) : null}
      </div>
    </>
  );
}

function TeamBlock({ side, winner, started, right = false }: { side: CbbSide; winner: boolean; started: boolean; right?: boolean }) {
  return (
    <Link
      to="/cbb/teams/$teamId"
      params={{ teamId: side.team.id }}
      className={`flex min-w-0 flex-1 items-center gap-3 hover:text-acc ${right ? "flex-row-reverse text-right" : ""}`}
    >
      <CbbLogo team={side.team} className="size-12 sm:size-16" />
      <div className="min-w-0">
        <p className="truncate font-disp text-lg font-bold uppercase leading-none tracking-tight sm:text-2xl">
          {side.rank ? <span className="mr-1 font-mono text-xs text-acc">{side.rank}</span> : null}
          {side.team.short}
        </p>
        <p className="mt-1 font-mono text-[10px] text-faint">{side.record ?? side.team.nickname}</p>
      </div>
      {started ? (
        <span className={`font-mono text-3xl tabular-nums sm:text-4xl ${winner ? "font-semibold" : "text-mute"}`}>{side.score}</span>
      ) : null}
    </Link>
  );
}

function Line({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="label-mono">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
      {sub ? <dd className="text-[11px] text-mute">{sub}</dd> : null}
    </div>
  );
}

function LineScore({ game }: { game: CbbGame }) {
  const n = Math.max(game.away.periods.length, game.home.periods.length, 2);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-faint">
            <th className="py-1 text-left font-normal" />
            {Array.from({ length: n }, (_, i) => (
              <th key={i} className="px-2 py-1 text-right font-normal">
                {periodLabel(i)}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-normal">T</th>
          </tr>
        </thead>
        <tbody>
          {[game.away, game.home].map((s) => (
            <tr key={s.team.id}>
              <td className="py-1">{s.team.abbr}</td>
              {Array.from({ length: n }, (_, i) => (
                <td key={i} className="px-2 py-1 text-right tabular-nums">
                  {s.periods[i] ?? "–"}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold tabular-nums">{s.score ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamStats({ game, stats }: { game: CbbGame; stats: { label: string; away: string; home: string }[] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Team stats" aside={<span className="label-mono">{game.away.team.abbr} · {game.home.team.abbr}</span>} />
      <div className="divide-y divide-line/5">
        {stats.map((s) => (
          <div key={s.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-1.5 font-mono text-xs">
            <span className="text-right tabular-nums">{s.away}</span>
            <span className="text-center text-[10px] uppercase tracking-wider text-faint">{s.label}</span>
            <span className="tabular-nums">{s.home}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BoxScore({ box, game }: { box: CbbBoxTeam; game: CbbGame }) {
  const team = [game.away.team, game.home.team].find((t) => t.id === box.teamId);
  if (!box.players.length) return null;
  return (
    <Panel padded={false}>
      <PanelHeader
        title={
          <span className="inline-flex items-center gap-2">
            {team ? <CbbLogo team={team} className="size-6" /> : null}
            {team?.short ?? box.abbr}
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Player</th>
              {box.labels.map((l) => (
                <th key={l} className="px-2 py-2 text-right font-normal">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {box.players.map((p) => (
              <tr key={p.id} className={p.starter ? "" : "text-mute"}>
                <td className="whitespace-nowrap px-4 py-1.5">
                  {p.name}
                  {p.position ? <span className="ml-1 font-mono text-[10px] text-faint">{p.position}</span> : null}
                </td>
                {p.dnp ? (
                  <td colSpan={box.labels.length} className="px-2 py-1.5 font-mono text-[11px] text-faint">
                    {p.dnp}
                  </td>
                ) : (
                  p.stats.map((v, i) => (
                    <td key={i} className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                      {v}
                    </td>
                  ))
                )}
              </tr>
            ))}
            {box.totals.length ? (
              <tr className="font-semibold">
                <td className="px-4 py-1.5">Team</td>
                {box.totals.map((v, i) => (
                  <td key={i} className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Plays({ game }: { game: CbbGame }) {
  const detail = useCbbGameDetail(game.id, game.status === "live");
  const plays = detail.data?.plays ?? [];
  const periods = [...new Set(plays.map((p) => p.period))].filter(Boolean).sort((a, b) => a - b);
  const [period, setPeriod] = useState<number | "all">("all");
  const [scoring, setScoring] = useState(true);
  const list = plays
    .filter((p) => (period === "all" || p.period === period) && (!scoring || p.scoring))
    .slice()
    .reverse();
  return (
    <Panel padded={false}>
      <PanelHeader
        title="Play-by-play"
        aside={
          <div className="flex flex-wrap gap-1">
            {(["all", ...periods] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ring-1 ${period === p ? "bg-acc/10 text-acc ring-acc/25" : "text-mute ring-line/10"}`}
              >
                {p === "all" ? "All" : periodLabel(p - 1)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setScoring((v) => !v)}
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ring-1 ${scoring ? "bg-acc/10 text-acc ring-acc/25" : "text-mute ring-line/10"}`}
            >
              Scoring only
            </button>
          </div>
        }
      />
      <ul className="max-h-[520px] divide-y divide-line/5 overflow-y-auto">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-faint">
              {periodLabel(p.period - 1)} {p.clock}
            </span>
            <span className={`min-w-0 flex-1 ${p.scoring ? "" : "text-mute"}`}>{p.text}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {p.awayScore ?? ""}–{p.homeScore ?? ""}
            </span>
          </li>
        ))}
        {!list.length ? <li className="px-4 py-6 text-center font-mono text-xs text-mute">No plays.</li> : null}
      </ul>
    </Panel>
  );
}
