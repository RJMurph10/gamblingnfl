/** One NBA game: header and lines, line score, model pick, then box score / team stats / plays tabs. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/booth";
import { NbaLogo, oddsLine, statusText } from "@/components/nba/NbaBits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  atsResult,
  hasScore,
  ouResult,
  pct,
  periodLabel,
  spreadText,
  type NbaBoxTeam,
  type NbaGame,
  type NbaGameDetail,
  type NbaPlay,
} from "@/lib/nba";
import { predictGame, buildRatings, rowFor, type NbaModelRow } from "@/lib/nba-model";
import { useNbaGameDetail, useNbaPrior, useNbaSchedule } from "@/lib/use-nba";

const tabClass =
  "rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent";

export function NbaGameDetailView({ gameId }: { gameId: string }) {
  const schedule = useNbaSchedule(false);
  const scheduled = schedule.games.find((g) => g.id === gameId);
  const detail = useNbaGameDetail(gameId, scheduled?.status === "live" || scheduled === undefined);
  const prior = useNbaPrior();
  const data = detail.data as NbaGameDetail | undefined;
  // The schedule refreshes more often than the summary, so it wins for the live score.
  const game: NbaGame | undefined = scheduled && data ? { ...data.game, ...scheduled, odds: scheduled.odds ?? data.game.odds } : (scheduled ?? data?.game);

  const row: NbaModelRow | null = useMemo(() => {
    if (!game || game.part === "pre") return null;
    const before = schedule.games.filter(
      (g) => g.status === "final" && g.part !== "pre" && hasScore(g) && g.date < game.date && g.id !== game.id,
    );
    const table = buildRatings(before, prior);
    return rowFor(game, predictGame(table, game.home.team.id, game.away.team.id));
  }, [game, schedule.games, prior]);

  if (!game) {
    return (
      <>
        <PageTitle eyebrow="NBA" title={detail.isLoading || schedule.isLoading ? "Loading game…" : "Game not found"} />
        {!detail.isLoading && !schedule.isLoading ? (
          <Panel>
            <p className="py-6 text-center font-mono text-xs text-mute">
              ESPN has no game with this id.{" "}
              <Link to="/nba/games" className="text-acc">
                All games →
              </Link>
            </p>
          </Panel>
        ) : null}
      </>
    );
  }

  const started = game.status !== "scheduled";
  return (
    <>
      <Header game={game} />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {started ? (
            <Panel>
              <LineScore game={game} />
            </Panel>
          ) : null}
          <Panel padded={false}>
            <Tabs defaultValue={started ? "box" : "stats"}>
              <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b border-line/10 bg-transparent p-0">
                <TabsTrigger value="box" className={tabClass}>Box score</TabsTrigger>
                <TabsTrigger value="stats" className={tabClass}>Team stats</TabsTrigger>
                <TabsTrigger value="plays" className={tabClass}>Play-by-play</TabsTrigger>
                <TabsTrigger value="flow" className={tabClass}>Win probability</TabsTrigger>
              </TabsList>
              <TabsContent value="box" className="m-0 p-4">
                <BoxScore detail={data} started={started} loading={detail.isLoading} />
              </TabsContent>
              <TabsContent value="stats" className="m-0 p-4">
                <TeamStats game={game} detail={data} started={started} />
              </TabsContent>
              <TabsContent value="plays" className="m-0 p-4">
                <Plays game={game} plays={data?.plays ?? []} started={started} />
              </TabsContent>
              <TabsContent value="flow" className="m-0 p-4">
                <WinProb game={game} detail={data} />
              </TabsContent>
            </Tabs>
          </Panel>
        </div>
        <aside className="min-w-0 space-y-6 lg:col-span-4">
          {row ? <ModelCard row={row} /> : null}
          <LinesCard game={game} />
          {data?.leaders.length ? <Leaders game={game} leaders={data.leaders} /> : null}
          {data?.injuries.length ? <Injuries game={game} injuries={data.injuries} /> : null}
          <Link
            to="/nba/props"
            search={{ game: game.id }}
            className="glass block p-3 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:glow"
          >
            Player prop projections for this game →
          </Link>
        </aside>
      </div>
    </>
  );
}

function Header({ game }: { game: NbaGame }) {
  const when = game.date
    ? new Date(game.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const finalDate = game.date
    ? new Date(game.date).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })
    : "";
  const isFinal = game.status === "final";
  const isOT = game.period > 4 || /\\b\\d?OT\\b/i.test(game.statusDetail);
  const spread = game.odds?.spread;
  const favorite = spread == null || spread === 0 ? null : spread < 0 ? game.home.team : game.away.team;
  const spreadLabel = spread == null ? "—" : spread === 0 ? "PK" : `-${Math.abs(spread).toFixed(1).replace(/\\.0$/, "")}`;

  if (isFinal) {
    const awayWon = hasScore(game) && (game.away.score as number) > (game.home.score as number);
    const homeWon = hasScore(game) && (game.home.score as number) > (game.away.score as number);
    return (
      <>
        <PageTitle
          eyebrow={[game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "NBA", game.note].filter(Boolean).join(" · ")}
          title={`${game.away.team.abbr} @ ${game.home.team.abbr}`}
        />
        <Panel className="mb-6">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <Link to="/nba/teams/$teamId" params={{ teamId: game.away.team.id }} className="group flex shrink-0 flex-col items-center gap-1 text-center">
                <NbaLogo team={game.away.team} className="size-10 transition-transform group-hover:scale-105 sm:size-14" />
                <span className="font-mono text-[10px] text-mute group-hover:text-acc sm:text-xs">{game.away.record ?? ""}</span>
              </Link>
              <span className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${awayWon ? "text-acc" : ""}`}>{game.away.score ?? ""}</span>
            </div>
            <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center">
              <span className="font-disp text-base font-bold tracking-wider text-acc sm:text-xl">{isOT ? "FINAL/OT" : "FINAL"}</span>
              <span className="font-mono text-[10px] text-mute sm:text-[11px]">{finalDate}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <span className={`font-mono text-3xl font-bold tabular-nums sm:text-5xl ${homeWon ? "text-acc" : ""}`}>{game.home.score ?? ""}</span>
              <Link to="/nba/teams/$teamId" params={{ teamId: game.home.team.id }} className="group flex shrink-0 flex-col items-center gap-1 text-center">
                <NbaLogo team={game.home.team} className="size-10 transition-transform group-hover:scale-105 sm:size-14" />
                <span className="font-mono text-[10px] text-mute group-hover:text-acc sm:text-xs">{game.home.record ?? ""}</span>
              </Link>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line/10 pt-3 font-mono text-[11px] text-mute">
            <span>Spread:</span>
            {favorite ? (
              <span className="inline-flex items-center gap-1">
                <NbaLogo team={favorite} className="size-4" />
                <span className="font-semibold text-foreground">{spreadLabel}</span>
              </span>
            ) : <span className="font-semibold text-foreground">{spreadLabel}</span>}
            <span>·</span>
            <span>O/U: <span className="font-semibold text-foreground">{game.odds?.total ?? "—"}</span></span>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageTitle
        eyebrow={[game.part === "pre" ? "Preseason" : game.part === "play-in" ? "Play-in" : game.part === "post" ? "Playoffs" : "NBA", game.note].filter(Boolean).join(" · ")}
        title={`${game.away.team.abbr} @ ${game.home.team.abbr}`}
      />
      <Panel className="mb-6">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {[game.away, game.home].map((s, i) => (
            <div key={s.team.id} className={i === 0 ? "order-1" : "order-3 text-right"}>
              <div className={`flex items-center gap-3 ${i === 1 ? "flex-row-reverse" : ""}`}>
                <Link to="/nba/teams/$teamId" params={{ teamId: s.team.id }}>
                  <NbaLogo team={s.team} className="size-14 sm:size-16" />
                </Link>
                <div className="min-w-0">
                  <Link to="/nba/teams/$teamId" params={{ teamId: s.team.id }} className="block truncate font-disp text-xl font-bold uppercase leading-none tracking-tight hover:text-acc sm:text-3xl">
                    {s.team.nickname}
                  </Link>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                    {i === 0 ? "Away" : "Home"}
                    {s.record ? ` · ${s.record}` : ""}
                  </span>
                </div>
                {hasScore(game) && game.status !== "scheduled" ? (
                  <span className="font-mono text-3xl font-semibold tabular-nums sm:text-5xl">{s.score}</span>
                ) : null}
              </div>
            </div>
          ))}
          <div className="order-2 text-center">
            <p className={`font-mono text-xs uppercase tracking-wider ${game.status === "live" ? "text-win" : "text-mute"}`} suppressHydrationWarning>
              {statusText(game)}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint" suppressHydrationWarning>
              {when}
            </p>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
          {[game.venue, game.broadcast, oddsLine(game)].filter(Boolean).join(" · ")}
        </p>
      </Panel>
    </>
  );
}

function LineScore({ game }: { game: NbaGame }) {
  const count = Math.max(4, game.away.periods.length, game.home.periods.length);
  const winner = game.status === "final" && hasScore(game) ? ((game.away.score as number) > (game.home.score as number) ? "away" : "home") : null;
  return (
    <table className="w-full text-center font-mono text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-faint">
          <th className="text-left font-normal">Team</th>
          {Array.from({ length: count }, (_, i) => (
            <th key={i} className="font-normal">{periodLabel(i)}</th>
          ))}
          <th className="text-right font-normal">{game.status === "final" ? "Final" : "T"}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {([["away", game.away], ["home", game.home]] as const).map(([key, s]) => (
          <tr key={key}>
            <td className="py-2 text-left font-medium">{s.team.nickname}</td>
            {Array.from({ length: count }, (_, i) => (
              <td key={i} className="py-2 tabular-nums text-mute">{s.periods[i] ?? (game.status === "final" || i < game.period ? 0 : "")}</td>
            ))}
            <td className={`py-2 text-right font-semibold tabular-nums ${winner === key ? "text-acc" : ""}`}>{s.score ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What the model thinks, and where it disagrees with the market. */
function ModelCard({ row }: { row: NbaModelRow }) {
  const { game, pred } = row;
  const fav = pred.margin >= 0 ? game.home.team : game.away.team;
  const result = (r: string | null | undefined) => (r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute");
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Model</h2>
      <p className="label-mono mb-3">Projected from earlier games only</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono tabular-nums">
        <span className="text-2xl">{pred.away.toFixed(0)}</span>
        <span className="text-[10px] uppercase tracking-wider text-faint">proj. score</span>
        <span className="text-right text-2xl">{pred.home.toFixed(0)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel2">
        <div className="h-2 bg-acc" style={{ width: `${(1 - pred.homeWinProb) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>{game.away.team.abbr} {pct(1 - pred.homeWinProb, 0)}</span>
        <span>{game.home.team.abbr} {pct(pred.homeWinProb, 0)}</span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Winner</dt>
          <dd className={`font-mono ${result(row.moneyline.result)}`}>{fav.abbr} by {Math.abs(pred.margin).toFixed(1)}{row.moneyline.result ? ` · ${row.moneyline.result}` : ""}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Spread</dt>
          <dd className={`font-mono ${result(row.spread?.result)}`}>
            {row.spread
              ? `${row.spread.best ? "★ " : ""}${row.spread.pick === "home" ? game.home.team.abbr : game.away.team.abbr} ${spreadText(game, row.spread.line)} (${row.spread.edge.toFixed(1)} pt edge)${row.spread.result ? ` · ${row.spread.result}` : ""}`
              : game.odds?.spread != null ? "No edge" : "No line"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mute">Total</dt>
          <dd className={`font-mono ${result(row.total?.result)}`}>
            {row.total
              ? `${row.total.best ? "★ " : ""}${row.total.pick} ${row.total.line} (proj ${pred.total.toFixed(1)})${row.total.result ? ` · ${row.total.result}` : ""}`
              : game.odds?.total ? `No edge (proj ${pred.total.toFixed(1)})` : `Proj ${pred.total.toFixed(1)}`}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function LinesCard({ game }: { game: NbaGame }) {
  const o = game.odds;
  const ats = atsResult(game);
  const ou = ouResult(game);
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Lines</h2>
      <p className="label-mono mb-3">{o?.provider ?? "ESPN odds"}</p>
      {o ? (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-mute">Spread</dt><dd className={`font-mono ${ats === "push" ? "text-mute" : ""}`}>{o.spread !== null ? spreadText(game, o.spread) : "—"}{ats && ats !== "push" ? ` · ${ats === "home" ? game.home.team.abbr : game.away.team.abbr} covered` : ats ? " · push" : ""}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">Total</dt><dd className="font-mono">{o.total ?? "—"}{ou ? ` · ${ou}` : ""}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">{game.away.team.abbr} moneyline</dt><dd className="font-mono">{o.mlAway ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-mute">{game.home.team.abbr} moneyline</dt><dd className="font-mono">{o.mlHome ?? "—"}</dd></div>
        </dl>
      ) : (
        <p className="font-mono text-xs text-mute">No lines posted yet.</p>
      )}
    </Panel>
  );
}

function BoxScore({ detail, started, loading }: { detail?: NbaGameDetail; started: boolean; loading: boolean }) {
  const [side, setSide] = useState(0);
  if (!started) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">The box score appears once the game is under way</p>;
  const teams = detail?.box ?? [];
  if (!teams.length)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">{loading ? "Loading box score…" : "ESPN has no box score yet."}</p>;
  const t = teams[Math.min(side, teams.length - 1)];
  return (
    <div>
      <div className="mb-3 flex gap-2">
        {teams.map((x, i) => (
          <button
            key={x.teamId}
            type="button"
            onClick={() => setSide(i)}
            aria-pressed={i === side}
            className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${i === side ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
          >
            {x.abbr}
          </button>
        ))}
      </div>
      <BoxTable team={t} />
    </div>
  );
}

function BoxTable({ team }: { team: NbaBoxTeam }) {
  const starters = team.players.filter((p) => p.starter);
  const bench = team.players.filter((p) => !p.starter);
  const group = (label: string, list: typeof team.players) => (
    <>
      <tr>
        <td colSpan={team.labels.length + 1} className="pt-3 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</td>
      </tr>
      {list.map((p) => (
        <tr key={p.id || p.name} className="hover:bg-line/5">
          <td className="sticky left-0 bg-panel py-1.5 pr-3">
            {p.id ? (
              <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="font-medium hover:text-acc">{p.name}</Link>
            ) : p.name}
            <span className="ml-1.5 font-mono text-[10px] text-faint">{p.position}</span>
          </td>
          {p.dnp ? (
            <td colSpan={team.labels.length} className="py-1.5 font-mono text-[11px] text-faint">{p.dnp}</td>
          ) : (
            team.labels.map((_, i) => (
              <td key={i} className="px-1.5 py-1.5 text-right font-mono text-[12px] tabular-nums">{p.stats[i] ?? ""}</td>
            ))
          )}
        </tr>
      ))}
    </>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="sticky left-0 bg-panel py-2 pr-3 font-normal">Player</th>
            {team.labels.map((l) => (
              <th key={l} className="px-1.5 py-2 text-right font-normal">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {starters.length ? group("Starters", starters) : null}
          {bench.length ? group(starters.length ? "Bench" : "Players", bench) : null}
          {team.totals.length ? (
            <tr className="border-t border-line/20 font-semibold">
              <td className="sticky left-0 bg-panel py-2">Team</td>
              {team.labels.map((_, i) => (
                <td key={i} className="px-1.5 py-2 text-right font-mono text-[12px] tabular-nums">{team.totals[i] ?? ""}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

const asNumber = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function TeamStats({ game, detail, started }: { game: NbaGame; detail?: NbaGameDetail; started: boolean }) {
  const rows = detail?.teamStats ?? [];
  if (!started || !rows.length)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Team stats appear once the game is under way</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center font-mono text-[10px] uppercase tracking-wider text-mute">
        <span className="flex items-center gap-2"><NbaLogo team={game.away.team} className="size-6" />{game.away.team.abbr}</span>
        <span />
        <span className="flex items-center justify-end gap-2">{game.home.team.abbr}<NbaLogo team={game.home.team} className="size-6" /></span>
      </div>
      {rows.map((r) => {
        const a = asNumber(r.away);
        const h = asNumber(r.home);
        const isPct = /%/.test(r.label) || /pct/i.test(r.label);
        const max = isPct ? 100 : Math.max(a, h, 1);
        const w = (v: number) => `${Math.min(100, Math.max(v > 0 ? 3 : 0, (v / max) * 100))}%`;
        return (
          <div key={r.label}>
            <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 font-mono text-[11px]">
              <span className="text-left tabular-nums">{r.away}</span>
              <span className="text-center text-faint">{r.label}</span>
              <span className="text-right tabular-nums">{r.home}</span>
            </div>
            <div className="flex gap-1">
              <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-full bg-panel2">
                <div className="h-2 rounded-full" style={{ width: w(a), backgroundColor: game.away.team.color }} />
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                <div className="h-2 rounded-full" style={{ width: w(h), backgroundColor: game.home.team.color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Plays({ game, plays, started }: { game: NbaGame; plays: NbaPlay[]; started: boolean }) {
  const [scoringOnly, setScoringOnly] = useState(true);
  const [period, setPeriod] = useState<number | "all">("all");
  const periods = [...new Set(plays.map((p) => p.period))].sort((a, b) => a - b);
  const shown = useMemo(
    () => plays.filter((p) => (!scoringOnly || p.scoring) && (period === "all" || p.period === period)).slice().reverse(),
    [plays, scoringOnly, period],
  );
  if (!started) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Play-by-play appears once the game is under way</p>;
  if (!plays.length) return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">ESPN has no play-by-play yet.</p>;
  const teamOf = (id?: string) => (id === game.home.team.id ? game.home.team : id === game.away.team.id ? game.away.team : null);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setScoringOnly((v) => !v)} aria-pressed={scoringOnly} className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${scoringOnly ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"}`}>
          Scoring plays
        </button>
        {(["all", ...periods] as (number | "all")[]).map((p) => (
          <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p} className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${period === p ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}>
            {p === "all" ? "All" : periodLabel(p - 1)}
          </button>
        ))}
      </div>
      <ul className="max-h-[560px] divide-y divide-line/5 overflow-y-auto">
        {shown.map((p) => {
          const t = teamOf(p.teamId);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">{periodLabel(p.period - 1)} {p.clock}</span>
              {t ? <NbaLogo team={t} className="size-5" /> : <span className="size-5" />}
              <span className={`min-w-0 flex-1 ${p.scoring ? "" : "text-mute"}`}>{p.text}</span>
              {p.awayScore !== null && p.homeScore !== null ? (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">{p.awayScore}–{p.homeScore}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WinProb({ game, detail }: { game: NbaGame; detail?: NbaGameDetail }) {
  const probs = detail?.winProb ?? [];
  if (probs.length < 2)
    return <p className="py-6 text-center font-mono text-[11px] uppercase tracking-wider text-faint">Win probability appears once the game is under way</p>;
  const W = 600;
  const H = 160;
  const step = W / (probs.length - 1);
  const points = probs.map((p, i) => `${(i * step).toFixed(1)},${((1 - p) * H).toFixed(1)}`).join(" ");
  const last = probs[probs.length - 1];
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-mute">
        <span>{game.home.team.abbr} win probability</span>
        <span className="text-acc">{pct(last, 0)} now</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full rounded-lg bg-panel2" preserveAspectRatio="none" role="img" aria-label="Win probability chart">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4 4" />
        <polyline points={points} fill="none" stroke="var(--acc)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
        <span>Tip-off</span>
        <span>{game.status === "final" ? "Final" : "Now"}</span>
      </div>
    </div>
  );
}

function Leaders({ game, leaders }: { game: NbaGame; leaders: NbaGameDetail["leaders"] }) {
  const cats = [...new Set(leaders.map((l) => l.category))].slice(0, 4);
  return (
    <Panel padded={false}>
      <PanelHeader title="Leaders" />
      <div className="divide-y divide-line/5">
        {cats.map((c) => (
          <div key={c} className="px-4 py-2">
            <p className="label-mono">{c}</p>
            {[game.away.team, game.home.team].map((t) => {
              const l = leaders.find((x) => x.category === c && x.teamId === t.id);
              return l ? (
                <div key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <NbaLogo team={t} className="size-4" />
                  {l.playerId ? <Link to="/nba/players/$playerId" params={{ playerId: l.playerId }} className="flex-1 truncate hover:text-acc">{l.name}</Link> : <span className="flex-1 truncate">{l.name}</span>}
                  <span className="font-mono text-xs tabular-nums text-mute">{l.value}</span>
                </div>
              ) : null;
            })}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Injuries({ game, injuries }: { game: NbaGame; injuries: NbaGameDetail["injuries"] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Injuries" />
      <div className="divide-y divide-line/5">
        {injuries.slice(0, 14).map((i, n) => {
          const t = i.teamId === game.home.team.id ? game.home.team : game.away.team;
          return (
            <div key={`${i.name}-${n}`} className="flex items-center gap-2 px-4 py-2 text-sm">
              <NbaLogo team={t} className="size-4" />
              <span className="flex-1 truncate">{i.name}</span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${/out/i.test(i.status) ? "text-loss" : "text-mute"}`}>{i.status}{i.detail ? ` · ${i.detail}` : ""}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
