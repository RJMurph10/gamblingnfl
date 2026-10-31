/** The selected NHL game: result/status, the model's projection, market comparison and line movement. */
import { useMemo } from "react";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { NhlLogo } from "@/components/nhl/NhlBits";
import { americanText, lineText, localTip, statusText, type NhlGame } from "@/lib/nhl/nhl";
import { type NhlMarketRow, type NhlProjection } from "@/lib/nhl/nhl-model";
import { marketRowsV2, projectGameV2, type NhlV2Projection } from "@/lib/nhl/nhl-model-v2";
import { useNhlModelInputs } from "@/lib/nhl/use-nhl";

const pct = (p: number | null | undefined, digits = 1) =>
  p === null || p === undefined ? "—" : `${(p * 100).toFixed(digits)}%`;

const signed = (n: number | null, digits: number, suffix = "") =>
  n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}${suffix}`;

const tone = (n: number | null) => (n === null ? "text-mute" : n > 0 ? "text-win" : n < 0 ? "text-loss" : "text-mute");

function Side({ game, side }: { game: NhlGame; side: "away" | "home" }) {
  const s = game[side];
  const started = game.status === "live" || game.status === "final";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <NhlLogo team={s.team} className="size-9 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{s.team.name}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-mute">
          {side === "away" ? "Away" : "Home"}
          {s.record ? ` · ${s.record}` : ""}
        </p>
      </div>
      {started && s.score !== null ? (
        <span className="ml-auto font-mono text-xl font-semibold tabular-nums">{s.score}</span>
      ) : null}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-2">
      <p className="label-mono">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-mute">{sub}</p> : null}
    </div>
  );
}

function ModelSummary({ game, p }: { game: NhlGame; p: NhlProjection }) {
  const A = game.away.team.abbr;
  const H = game.home.team.abbr;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Projected goals" value={`${p.awayGoals.toFixed(2)} – ${p.homeGoals.toFixed(2)}`} sub={`${A} – ${H}, 60 minutes`} />
      <Stat label="Projected total" value={p.expTotal.toFixed(2)} sub="includes any overtime goal" />
      <Stat label="Win probability" value={`${pct(p.pAway, 0)} – ${pct(p.pHome, 0)}`} sub={`${A} – ${H}, overtime included`} />
      <Stat
        label="Decided in regulation"
        value={pct(1 - p.pOvertime, 0)}
        sub={`${pct(p.pAwayReg, 0)} ${A} · ${pct(p.pHomeReg, 0)} ${H} · ${pct(p.pOvertime, 0)} OT/SO`}
      />
    </div>
  );
}

function MarketTable({ rows }: { rows: NhlMarketRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-3 py-2 font-normal">Market</th>
            <th className="px-2 py-2 font-normal">Pick</th>
            <th className="px-2 py-2 text-right font-normal">Book</th>
            <th className="px-2 py-2 text-right font-normal">Model</th>
            <th className="px-2 py-2 text-right font-normal">Fair odds</th>
            <th className="px-2 py-2 text-right font-normal">No-vig book</th>
            <th className="px-2 py-2 text-right font-normal">Edge</th>
            <th className="px-3 py-2 text-right font-normal">EV / 1u</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {rows.map((r, i) => {
            const first = i === 0 || rows[i - 1].market !== r.market;
            return (
              <tr key={`${r.market}-${r.label}`} className={first && i > 0 ? "border-t border-line/15" : ""}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-mute">
                  {first ? r.market : ""}
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-medium">
                  {r.label}
                  {r.reference ? <span className="ml-1.5 font-mono text-[9px] uppercase text-faint">model only</span> : null}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{americanText(r.price)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{pct(r.pModel)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{americanText(r.fair)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-mute">{pct(r.pMarket)}</td>
                <td className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums ${tone(r.edge)}`}>
                  {signed(r.edge === null ? null : r.edge * 100, 1, " pp")}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums ${tone(r.ev)}`}>
                  {signed(r.ev, 3, "u")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Movement({ game }: { game: NhlGame }) {
  const o = game.odds;
  const rows: { label: string; open: string; now: string }[] = [];
  if (o?.open) {
    const A = game.away.team.abbr;
    const H = game.home.team.abbr;
    if (o.open.mlAway != null) rows.push({ label: `${A} moneyline`, open: americanText(o.open.mlAway), now: americanText(o.mlAway) });
    if (o.open.mlHome != null) rows.push({ label: `${H} moneyline`, open: americanText(o.open.mlHome), now: americanText(o.mlHome) });
    if (o.open.spread != null) rows.push({ label: `${H} puck line`, open: lineText(o.open.spread), now: lineText(o.spread) });
    if (o.open.total != null) rows.push({ label: "Total", open: lineText(o.open.total, false), now: lineText(o.total, false) });
  }
  if (!rows.length) {
    return (
      <p className="px-1 text-xs text-mute">
        ESPN has not provided opening lines for this game, so line movement is unavailable. Only the current numbers are shown.
      </p>
    );
  }
  return (
    <table className="w-full max-w-md text-sm">
      <thead>
        <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
          <th className="px-1 py-1.5 font-normal">Line</th>
          <th className="px-2 py-1.5 text-right font-normal">Open</th>
          <th className="px-2 py-1.5 text-right font-normal">Current</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="px-1 py-1.5">{r.label}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-mute">{r.open}</td>
            <td className="px-2 py-1.5 text-right font-mono tabular-nums">{r.now}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Factors({ game, p }: { game: NhlGame; p: NhlV2Projection }) {
  const f = p.features;
  const A = game.away.team.abbr;
  const H = game.home.team.abbr;
  const rest = (s: NhlV2Projection["features"]["home"]) => (s.b2b ? "back-to-back" : s.rest3 ? "3+ days off" : "normal rest");
  const goalie = (s: NhlV2Projection["features"]["home"]) =>
    s.goalie ? `${s.goalie} (${s.sv >= 1 ? "+" : ""}${((s.sv - 1) * 100).toFixed(1)}% vs avg saves)` : "starter unknown";
  return (
    <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
      {A}: {goalie(f.away)}, {rest(f.away)} · {H}: {goalie(f.home)}, {rest(f.home)}
      {f.current ? "" : " · last season's shots and goalie history only"}
    </p>
  );
}

/**
 * `embedded`: on the game page's Markets tab, where the scoreboard, the model card and the lines card
 * already show the teams, projections and line movement, only the model-vs-book table is shown.
 */
export function NhlGameBoard({ game, games, embedded = false }: { game: NhlGame; games: NhlGame[]; embedded?: boolean }) {
  const { inputs } = useNhlModelInputs();
  const projection = useMemo(
    () => (game.status === "postponed" ? null : projectGameV2(game, games, inputs)),
    [game, games, inputs],
  );
  const rows = useMemo(() => (projection?.ok ? marketRowsV2(game, projection) : []), [game, projection]);
  const hasBook = Boolean(game.odds);

  return (
    <Panel padded={false}>
      <PanelHeader
        title={embedded ? "Model vs sportsbook" : "Game analysis"}
        aside={
          <span
            className={`font-mono text-[10px] uppercase tracking-wider sm:text-xs ${game.status === "live" ? "text-win" : "text-mute"}`}
            suppressHydrationWarning
          >
            {game.status === "scheduled" ? localTip(game.date) : statusText(game)}
          </span>
        }
      />
      <div className="space-y-5 px-3 pb-4 sm:px-4">
        {!embedded ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Side game={game} side="away" />
            <Side game={game} side="home" />
          </div>
        ) : null}
        {!embedded && (game.venue || game.broadcast) ? (
          <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
            {[game.venue, game.broadcast].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        {game.status === "postponed" ? (
          <p className="text-sm text-mute">This game is postponed, so there is nothing to project.</p>
        ) : !projection?.ok ? (
          <p className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-3 text-sm text-mute">
            Model unavailable. {projection?.reason ?? ""} No probabilities or edges are shown.
          </p>
        ) : (
          <>
            {game.status !== "scheduled" ? (
              <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
                Pregame model: uses only games played before puck drop.
              </p>
            ) : null}
            {!embedded ? <ModelSummary game={game} p={projection} /> : null}
            <Factors game={game} p={projection} />

            <div>
              {!embedded ? <h3 className="label-mono mb-2">Markets · model vs sportsbook</h3> : null}
              {!hasBook ? (
                <p className="mb-2 text-xs text-mute">
                  No sportsbook lines are posted for this game yet, so there is no price to compare. Model probabilities and
                  fair odds are shown on their own.
                </p>
              ) : null}
              <MarketTable rows={rows} />
              {rows.some((r) => r.reference) && hasBook ? (
                <p className="mt-2 text-xs text-mute">
                  No puck line is posted, so the standard ±1.5 is shown for reference (“model only”).
                </p>
              ) : null}
              {hasBook && rows.some((r) => r.price === null && r.market !== "Moneyline") ? (
                <p className="mt-2 text-xs text-mute">
                  Edge and EV appear only where ESPN supplies a price; nothing is assumed (no default −110).
                </p>
              ) : null}
            </div>

            {!embedded ? (
              <div>
                <h3 className="label-mono mb-2">Line movement</h3>
                <Movement game={game} />
              </div>
            ) : null}

            <details className="rounded-lg border border-line/10 bg-panel2/20 px-3 py-2 text-xs text-mute">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-faint">
                How this is calculated
              </summary>
              <div className="mt-2 space-y-1.5 leading-relaxed">
                <p>
                  <b>Ratings.</b> Each team&apos;s regulation goals for and against and its shots on goal for and against, per game.
                  This season so far is blended with 15 games of last season (pulled a third of the way to league average) and 5
                  games of league average, so the model works from opening night ({projection.samples.league} league games so
                  far; {game.away.team.abbr} {projection.samples.away}, {game.home.team.abbr} {projection.samples.home}).
                </p>
                <p>
                  <b>Goalies and rest.</b> The opponent&apos;s expected starter (most starts this season) counts through his save %
                  over several seasons, with 2,000 shots of league-average goaltending added. Playing the day before lowers a
                  team&apos;s goals about 5% and raises goals against about 5%; 3+ days off raises goals against about 3%.
                </p>
                <p>
                  <b>Goals and overtime.</b> Expected goals feed the same final-score grid as before (Poisson goals; an overtime or
                  shootout winner gets one more goal, so an overtime win never covers −1.5). Each market&apos;s probability is
                  then recalibrated from past seasons, and the overtime chance is scaled to how often NHL games are really tied
                  after 60 minutes.
                </p>
                <p>
                  <b>Fair odds</b> = the American price of the model probability. <b>No-vig book</b> = the book&apos;s two prices with
                  the margin removed proportionally. <b>Edge</b> = model − no-vig book (percentage points). <b>EV</b> = p × (decimal
                  odds − 1) − (1 − p), per 1u at the book&apos;s price. Pushes are removed before comparing.
                </p>
                <p>
                  Live and finished games show what the model knew before puck drop (this season&apos;s shot and save totals
                  are left out). Not modeled: injuries and confirmed starting goalies. Treat these numbers as research, not
                  advice.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
    </Panel>
  );
}
