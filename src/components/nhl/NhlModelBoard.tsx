/**
 * The NHL model page body, laid out like the NFL / college model page: record cards, what the model has
 * learned, track record by season, watch list, units by week, the next slate's picks, graded picks and
 * how it works.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/booth";
import { NhlLogo } from "@/components/nhl/NhlBits";
import { NHL_HISTORY, type NhlHistoryRecord } from "@/data/nhl-history";
import { NHL_MODEL_PARAMS } from "@/data/nhl-model-params";
import { etDayKey, etShortLabel, localTip, type NhlGame } from "@/lib/nhl";
import { projectGame, unitsText } from "@/lib/nhl-model";
import { compareNhlModels, espnSeasonYear, TRACK_EDGE, type NhlModelInputs } from "@/lib/nhl-model-v2";
import {
  buildNhlPickRows,
  NHL_WATCH_RULES,
  summarizeNhlPicks,
  watchHits,
  type NhlMarket,
  type NhlPick,
  type NhlPickRow,
  type NhlRecordU,
} from "@/lib/nhl-picks";

const MARKET_LABEL: Record<NhlMarket, string> = { moneyline: "Moneyline", puckLine: "Puck line", total: "Total" };
const oddsText = (o: number | null) => (o === null ? "—" : o > 0 ? `+${o}` : String(o));
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const recText = (r: { wins: number; losses: number; pushes: number }) =>
  `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const tone = (u: number | null) => (u === null || u === 0 ? "text-mute" : u > 0 ? "text-win" : "text-loss");
const resultClass = (r: NhlPick["result"]) => (r === "win" ? "text-win" : r === "loss" ? "text-loss" : "text-mute");
const CURRENT = espnSeasonYear() - 1;
const seasonLabel = (s: number) => `${s}-${String(s + 1).slice(2)}`;

function Matchup({ game, scores = false }: { game: NhlGame; scores?: boolean }) {
  return (
    <Link
      to="/nhl/games/$gameId"
      params={{ gameId: game.id }}
      title={`${game.away.team.name} @ ${game.home.team.name}`}
      className="inline-flex items-center gap-2 whitespace-nowrap font-mono tabular-nums transition-opacity hover:opacity-80"
    >
      {scores ? <span>{game.away.score ?? ""}</span> : null}
      <NhlLogo team={game.away.team} className="size-6" />
      <span className="text-faint">@</span>
      <NhlLogo team={game.home.team} className="size-6" />
      {scores ? <span>{game.home.score ?? ""}</span> : null}
      {scores && /OT|SO/i.test(game.statusDetail) ? (
        <span className="text-[10px] text-faint">({/SO/i.test(game.statusDetail) ? "SO" : "OT"})</span>
      ) : null}
    </Link>
  );
}

function PickChip({ pick, game }: { pick: NhlPick; game: NhlGame }) {
  const team = pick.side === "home" ? game.home.team : pick.side === "away" ? game.away.team : null;
  return (
    <span
      title={`${pick.tracked ? "Tracked edge · " : "Lean · "}${MARKET_LABEL[pick.market]} · model ${(pick.prob * 100).toFixed(0)}%${
        pick.edge !== null ? ` · edge ${pick.edge > 0 ? "+" : ""}${(pick.edge * 100).toFixed(1)} pts` : ""
      }`}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 ${
        pick.tracked ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10"
      }`}
    >
      {pick.tracked ? <span aria-label="Tracked edge">◆</span> : null}
      <span className={`text-[9px] uppercase tracking-wider ${pick.tracked ? "text-acc/70" : "text-faint"}`}>
        {pick.tracked ? "Open ML" : MARKET_LABEL[pick.market]}
      </span>
      {team ? <NhlLogo team={team} className="size-4" /> : null}
      <span className="ml-0.5">{pick.market === "moneyline" ? "ML" : team ? pick.label.replace(team.abbr, "").trim() : pick.label}</span>
      <span className="text-mute">{oddsText(pick.odds)}</span>
    </span>
  );
}

function UnitsByWeek({ data }: { data: { week: number; units: number; weekUnits: number }[] }) {
  if (!data.length) return <p className="px-4 py-6 text-center font-mono text-xs text-mute">No graded picks with prices yet.</p>;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.weekUnits)));
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto px-4 py-4" role="img" aria-label="Units won by week">
      {data.map((d) => {
        const h = Math.max(3, Math.round((Math.abs(d.weekUnits) / max) * 48));
        const up = d.weekUnits >= 0;
        return (
          <div key={d.week} className="flex w-14 shrink-0 flex-col items-center gap-1">
            <span className={`font-mono text-[10px] tabular-nums ${d.units >= 0 ? "text-win" : "text-loss"}`}>{unitsText(d.units)}</span>
            <div className="flex h-24 w-full flex-col justify-center">
              <div className="flex h-12 items-end">{up ? <div className="w-full rounded-t-sm bg-win/70" style={{ height: h }} /> : null}</div>
              <div className="h-px w-full bg-line/20" />
              <div className="flex h-12 items-start">{!up ? <div className="w-full rounded-b-sm bg-loss/70" style={{ height: h }} /> : null}</div>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-mute">{unitsText(d.weekUnits)}</span>
            <span className="font-mono text-[9px] uppercase text-faint">Wk {d.week}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A record cell: W-L, win %, and units on the priced picks. */
function RecCell({ r }: { r: (NhlHistoryRecord & { winPct?: number | null }) | NhlRecordU | null }) {
  if (!r) return <td className="px-3 py-2 text-right font-mono text-faint">—</td>;
  const n = r.wins + r.losses;
  const pct = n ? (r.wins / n) * 100 : null;
  const units = "priced" in r && r.priced === 0 ? null : r.units;
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
      <span>{recText(r)}</span>
      <span className="ml-2 text-mute">{pct === null ? "—" : `${one(pct)}%`}</span>
      <span className={`ml-2 ${tone(units)}`} title={units === null ? "No prices" : `Units on ${r.priced} priced picks`}>
        {units === null ? "—" : unitsText(units)}
      </span>
    </td>
  );
}

function WatchList({ games }: { games: NhlGame[] }) {
  return (
    <Panel padded={false}>
      <PanelHeader title="Watch list" aside={<span className="label-mono">Tracked · not used in picks</span>} />
      <p className="px-4 pt-3 text-sm text-mute">
        Angles that passed both test periods at closing prices but haven&apos;t proven themselves. Every qualifying game is graded at 1 unit
        at its moneyline. An angle joins the picks only if it keeps winning on new games.
      </p>
      <div className="divide-y divide-line/10">
        {Object.entries(NHL_WATCH_RULES).map(([key, rule]) => {
          const hist = NHL_HISTORY.watch[key]?.seasons ?? [];
          const hits = watchHits(games, key);
          const done = hits.filter((h) => h.result !== "pending");
          const live = done.reduce(
            (r, h) => {
              if (h.result === "win") r.wins++;
              else if (h.result === "loss") r.losses++;
              if (h.odds !== null) {
                r.units += h.units;
                r.priced++;
              }
              return r;
            },
            { wins: 0, losses: 0, pushes: 0, units: 0, priced: 0 },
          );
          const all = [...hist, live].reduce(
            (r, s) => ({ wins: r.wins + s.wins, losses: r.losses + s.losses, units: r.units + (s.units ?? 0) }),
            { wins: 0, losses: 0, units: 0 },
          );
          const upcoming = hits.filter((h) => h.result === "pending");
          return (
            <div key={key} className="px-4 py-4">
              <h3 className="font-disp text-base font-semibold uppercase tracking-tight">{rule.title}</h3>
              <p className="mt-1 text-sm">
                <span className="text-faint">Bet: </span>
                {rule.bet} <span className="text-mute">{rule.why}</span>
              </p>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="py-1 font-normal">Season</th>
                      <th className="py-1 text-right font-normal">Record</th>
                      <th className="py-1 text-right font-normal">Win %</th>
                      <th className="py-1 text-right font-normal">Units</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {[{ label: `${seasonLabel(CURRENT)} so far`, ...live }, ...[...hist].reverse().slice(0, 5)].map((s) => (
                      <tr key={s.label}>
                        <td className="py-1">{s.label}</td>
                        <td className="py-1 text-right">{recText(s)}</td>
                        <td className="py-1 text-right text-mute">{s.wins + s.losses ? `${one((s.wins / (s.wins + s.losses)) * 100)}%` : "—"}</td>
                        <td className={`py-1 text-right ${tone(s.units)}`}>{unitsText(s.units ?? 0)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line/10">
                      <td className="py-1">All{hist.length ? ` (since ${hist[0].label.slice(0, 4)})` : ""}</td>
                      <td className="py-1 text-right">{all.wins}-{all.losses}</td>
                      <td className="py-1 text-right text-mute">{all.wins + all.losses ? `${one((all.wins / (all.wins + all.losses)) * 100)}%` : "—"}</td>
                      <td className={`py-1 text-right ${tone(all.units)}`}>{unitsText(all.units)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="space-y-2 text-sm">
                  <p className="label-mono">Upcoming</p>
                  {upcoming.length ? (
                    upcoming.slice(0, 4).map((h) => (
                      <div key={h.game.id} className="flex flex-wrap items-center gap-2">
                        <span className="w-12 font-mono text-[11px] text-faint">{etShortLabel(etDayKey(h.game.date)).replace(/^\w+, /, "")}</span>
                        <Matchup game={h.game} />
                        <span className="font-mono text-xs">
                          {h.side === "home" ? h.game.home.team.abbr : h.game.away.team.abbr} ML {oddsText(h.odds)}
                        </span>
                        <span className="text-xs text-mute">{h.detail}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-mute">No upcoming games qualify.</p>
                  )}
                  <p className="label-mono pt-2">Most recent</p>
                  {done.length ? (
                    done.slice(0, 4).map((h) => (
                      <div key={h.game.id} className="flex flex-wrap items-center gap-2">
                        <Matchup game={h.game} scores />
                        <span className="font-mono text-xs">
                          {h.side === "home" ? h.game.home.team.abbr : h.game.away.team.abbr} ML {oddsText(h.odds)}
                        </span>
                        <span className={`font-mono text-[11px] uppercase ${resultClass(h.result)}`}>{h.result}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-mute">None yet this season.</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[11px] text-faint">
        Past seasons use closing moneylines (Sportsbook Reviews Online through Nov 2022; DraftKings via ESPN for 2025-26, where available).
        This season uses ESPN&apos;s current or closing line.
      </p>
    </Panel>
  );
}

export function NhlModelBoard({
  games,
  inputs,
  loading,
}: {
  games: NhlGame[];
  inputs: NhlModelInputs | null;
  loading: boolean;
}) {
  const rows = useMemo(() => buildNhlPickRows(games, inputs), [games, inputs]);
  const s = useMemo(() => summarizeNhlPicks(rows), [rows]);
  const cmp = useMemo(() => compareNhlModels(games, (g) => projectGame(g, games), inputs), [games, inputs]);
  const [market, setMarket] = useState<NhlMarket | "all">("all");
  const [scope, setScope] = useState<"every" | "tracked">("every");
  const [showAll, setShowAll] = useState(false);

  // next slate: the first Eastern day with games still to play
  const nextDay = useMemo(() => {
    const open = rows.filter((r) => r.game.status !== "final").map((r) => etDayKey(r.game.date));
    return open.length ? open.sort()[0] : null;
  }, [rows]);
  const slate = rows.filter((r) => r.game.status !== "final" && etDayKey(r.game.date) === nextDay);

  const graded: { pick: NhlPick; row: NhlPickRow }[] = rows
    .flatMap((row) =>
      (scope === "tracked" ? (row.trackedPick ? [row.trackedPick] : []) : row.picks)
        .filter((p) => p.result !== "pending")
        .map((pick) => ({ pick, row })),
    )
    .filter(({ pick }) => market === "all" || pick.market === market)
    .sort((a, b) => b.row.game.date.localeCompare(a.row.game.date));

  const card = (m: NhlMarket, label: string) => {
    const r = s.byMarket[m];
    return (
      <StatCard
        key={m}
        label={label}
        value={recText(r)}
        note={`${r.winPct === null ? "—" : `${one(r.winPct)}%`} · ${unitsText(r.units)}`}
        tone={r.units > 0 ? "win" : r.units < 0 ? "loss" : "mute"}
      />
    );
  };
  const t = s.tracked;
  const moved = t.movedToward + t.movedAgainst;
  const c = NHL_MODEL_PARAMS.coefficients;
  const pctEffect = (b: number) => `${b > 0 ? "+" : ""}${((Math.exp(b) - 1) * 100).toFixed(1)}%`;

  return (
    <>
      <PageTitle eyebrow={`gnhl-${NHL_MODEL_PARAMS.version} · flat 1 unit per pick`} title="Model" />
      {loading ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">Loading the schedule and lines…</p>
        </Panel>
      ) : !rows.length ? (
        <Panel>
          <p className="py-8 text-center font-mono text-xs text-mute">The schedule couldn&apos;t be loaded right now.</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Units · every game"
              value={unitsText(s.overall.units)}
              note={s.overall.roi === null ? "No priced picks graded yet" : `ROI ${s.overall.roi > 0 ? "+" : ""}${one(s.overall.roi)}% · ${s.overall.priced} priced`}
              tone={s.overall.units > 0 ? "win" : s.overall.units < 0 ? "loss" : "mute"}
            />
            {card("moneyline", "Winner · every game")}
            {card("puckLine", "Puck line")}
            {card("total", "Over / under")}
            <StatCard
              label={`◆ Tracked edges · ${Math.round(TRACK_EDGE * 100)}+ pts`}
              value={t.wins + t.losses ? recText(t) : "—"}
              note={
                t.wins + t.losses
                  ? `${unitsText(t.units)} at the opening price${moved ? ` · line moved our way ${Math.round((t.movedToward / moved) * 100)}%` : ""}`
                  : "Needs ESPN opening lines"
              }
              tone={t.units > 0 ? "win" : t.units < 0 ? "loss" : "mute"}
            />
          </div>

          <Panel>
            <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">What the model has learned</h2>
            <p className="mt-1 text-sm text-mute">
              Fitted on every regular-season game from 2008-09 to {NHL_MODEL_PARAMS.fittedThrough} and checked walk-forward. This season so far,
              graded from earlier games only ({cmp.games} games):
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="label-mono">Log loss · new model</p>
                <p className="mt-1 font-mono text-xl tabular-nums">{cmp.v2.logLoss === null ? "—" : cmp.v2.logLoss.toFixed(3)}</p>
                <p className="text-[11px] text-faint">
                  old model {cmp.v1.logLoss === null ? "—" : cmp.v1.logLoss.toFixed(3)}
                  {cmp.book.logLoss !== null ? ` · closing line ${cmp.book.logLoss.toFixed(3)}` : ""}
                </p>
              </div>
              <div>
                <p className="label-mono">Back-to-back</p>
                <p className="mt-1 font-mono text-xl tabular-nums">{pctEffect(c.attBackToBack)}</p>
                <p className="text-[11px] text-faint">goals scored · {pctEffect(c.defBackToBack)} allowed</p>
              </div>
              <div>
                <p className="label-mono">Home ice</p>
                <p className="mt-1 font-mono text-xl tabular-nums">{pctEffect(c.home)}</p>
                <p className="text-[11px] text-faint">goals for the home team</p>
              </div>
              <div>
                <p className="label-mono">Goalie · 1% better save rate</p>
                <p className="mt-1 font-mono text-xl tabular-nums">{pctEffect(c.defGoalie * Math.log(1.01))}</p>
                <p className="text-[11px] text-faint">goals allowed</p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-faint">
              Log loss scores the win probabilities (lower is better; 0.693 = always saying 50%). Tested features that added nothing were left
              out: expected goals beyond shot counts, high-danger chances, special teams, travel and time zones.
            </p>
          </Panel>

          <Panel padded={false}>
            <PanelHeader title="Track record by season" aside={<span className="label-mono">Same model · walk-forward · real prices</span>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-3 py-2 font-normal">Season</th>
                    <th className="px-3 py-2 text-right font-normal">Winner</th>
                    <th className="px-3 py-2 text-right font-normal">Puck line</th>
                    <th className="px-3 py-2 text-right font-normal">Over / under</th>
                    <th className="px-3 py-2 text-right font-normal">◆ Tracked edges</th>
                    <th className="px-3 py-2 font-normal">Prices</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/10">
                    <td className="px-3 py-2 font-mono">{seasonLabel(CURRENT)} so far</td>
                    <RecCell r={s.byMarket.moneyline} />
                    <RecCell r={s.byMarket.puckLine} />
                    <RecCell r={s.byMarket.total} />
                    <RecCell r={t.wins + t.losses ? t : null} />
                    <td className="px-3 py-2 font-mono text-[11px] text-mute">ESPN</td>
                  </tr>
                  {[...NHL_HISTORY.seasons].reverse().map((h) => (
                    <tr key={h.season} className="border-b border-line/10 last:border-0">
                      <td className="px-3 py-2 font-mono">{h.label}</td>
                      <RecCell r={h.winner} />
                      <RecCell r={h.puckLine} />
                      <RecCell r={h.total} />
                      <RecCell r={h.tracked} />
                      <td className="px-3 py-2 font-mono text-[11px] text-mute">{h.source === "none" ? "—" : h.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-3 pt-2 text-[11px] text-faint">
              Each past season is replayed game by game with only earlier games, and coefficients and calibration fitted on earlier seasons.
              Winner = the team it expected to win, at the closing moneyline; puck line and over / under are its side of the posted line at its
              price; ◆ tracked edges = {Math.round(TRACK_EDGE * 100)}+ points over the no-vig opening moneyline, at the opening price. Units count
              only picks with a price: SBR stops on Nov 27, 2022; 2023-24 is Unibet&apos;s 3-way moneyline (no winner units); 2024-25 has no free
              odds; 2025-26 DraftKings starts Nov 26. Puck lines and totals have lost money in most seasons; the tracked edges won before 2023
              but not against DraftKings in 2025-26, so they stay tracked, not ★.
            </p>
          </Panel>

          <WatchList games={games} />

          <Panel padded={false}>
            <PanelHeader title="Units by week" aside={<span className="label-mono">Running total above</span>} />
            <UnitsByWeek data={s.unitsByWeek} />
          </Panel>

          <Panel padded={false}>
            <PanelHeader
              title={nextDay ? `${etShortLabel(nextDay)} picks` : "Upcoming picks"}
              aside={<span className="label-mono">Lines update until puck drop</span>}
            />
            {!slate.length ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">No upcoming games.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Matchup</th>
                      <th className="px-2 py-2 font-normal">Puck drop</th>
                      <th className="px-2 py-2 text-right font-normal">Goals (A – H)</th>
                      <th className="px-2 py-2 text-right font-normal">Total</th>
                      <th className="px-2 py-2 text-right font-normal">Home win</th>
                      <th className="px-4 py-2 font-normal">Picks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {slate.map((row) => {
                      const p = row.projection;
                      const o = row.game.odds;
                      const f = p?.features;
                      return (
                        <tr key={row.game.id} className="hover:bg-line/5">
                          <td className="px-4 py-2.5">
                            <Matchup game={row.game} />
                          </td>
                          <td suppressHydrationWarning className="px-2 py-2.5 font-mono text-[11px] text-mute">
                            {row.game.status === "live" ? "Live" : localTip(row.game.date)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {p ? `${p.awayGoals.toFixed(2)} – ${p.homeGoals.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {p ? p.expTotal.toFixed(1) : "—"}
                            <span className="ml-1 text-[11px] text-faint">mkt {o?.total ?? "—"}</span>
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">
                            {p ? `${Math.round(p.pHome * 100)}%` : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            {!p ? (
                              <span className="text-[11px] text-faint">Model unavailable</span>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-1.5">
                                  {row.trackedPick ? <PickChip pick={row.trackedPick} game={row.game} /> : null}
                                  {row.picks.map((pk) => (
                                    <PickChip key={pk.market} pick={pk} game={row.game} />
                                  ))}
                                </div>
                                <ul className="mt-1.5 space-y-0.5 text-[11px]">
                                  {f ? (
                                    <li className="flex items-baseline gap-1.5">
                                      <span className="font-mono text-[9px] uppercase tracking-wider text-faint">G</span>
                                      <span className="text-mute">
                                        {row.game.away.team.abbr} {f.away.goalie ?? "starter unknown"} · {row.game.home.team.abbr}{" "}
                                        {f.home.goalie ?? "starter unknown"}
                                      </span>
                                    </li>
                                  ) : null}
                                  {f && (f.home.b2b || f.away.b2b) ? (
                                    <li className="flex items-baseline gap-1.5">
                                      <span className="font-mono text-[9px] uppercase tracking-wider text-faint">REST</span>
                                      <span className="text-mute">
                                        {[f.away.b2b && `${row.game.away.team.abbr} on a back-to-back`, f.home.b2b && `${row.game.home.team.abbr} on a back-to-back`]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </span>
                                    </li>
                                  ) : null}
                                  {o?.open?.mlHome != null && o.mlHome != null ? (
                                    <li className="flex items-baseline gap-1.5">
                                      <span className="font-mono text-[9px] uppercase tracking-wider text-faint">LINE</span>
                                      <span className="text-mute">
                                        {row.game.home.team.abbr} opened {oddsText(o.open.mlHome)} → now {oddsText(o.mlHome)}
                                      </span>
                                    </li>
                                  ) : null}
                                </ul>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel padded={false}>
            <PanelHeader
              title="Graded picks"
              aside={
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filter graded picks">
                  {(
                    [
                      ["every", "Every game"],
                      ["tracked", "◆ Tracked"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={scope === key}
                      onClick={() => setScope(key)}
                      className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                        scope === key ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="mx-1 w-px self-stretch bg-line/10" aria-hidden />
                  {(["all", "moneyline", "puckLine", "total"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={market === m}
                      onClick={() => setMarket(m)}
                      className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ${
                        market === m ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"
                      }`}
                    >
                      {m === "all" ? "All" : MARKET_LABEL[m]}
                    </button>
                  ))}
                </div>
              }
            />
            {!graded.length ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">No graded picks yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-normal">Wk</th>
                        <th className="px-2 py-2 text-center font-normal">Final</th>
                        <th className="px-2 py-2 font-normal">Pick</th>
                        <th className="px-2 py-2 text-right font-normal">Odds</th>
                        <th className="px-2 py-2 text-right font-normal">Model</th>
                        <th className="px-2 py-2 text-right font-normal">Result</th>
                        <th className="px-4 py-2 text-right font-normal">Units</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/5">
                      {(showAll ? graded : graded.slice(0, 40)).map(({ pick, row }) => (
                        <tr key={`${row.game.id}-${pick.market}-${pick.tracked}`} className="hover:bg-line/5">
                          <td className="px-4 py-2.5 font-mono text-mute">{row.week}</td>
                          <td className="px-2 py-2.5 text-center">
                            <Matchup game={row.game} scores />
                          </td>
                          <td className="px-2 py-2.5 font-mono">
                            <span className="mr-1.5 text-[9px] uppercase tracking-wider text-faint">
                              {pick.tracked ? "Open ML" : MARKET_LABEL[pick.market]}
                            </span>
                            {pick.label}
                            {pick.market === "moneyline" ? " ML" : ""}
                            {pick.tracked ? <span className="ml-1.5 text-acc">◆</span> : null}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">{oddsText(pick.odds)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-mute">{Math.round(pick.prob * 100)}%</td>
                          <td className={`px-2 py-2.5 text-right font-mono text-[11px] uppercase tracking-wider ${resultClass(pick.result)}`}>
                            {pick.result}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${resultClass(pick.result)}`}>
                            {pick.odds === null ? "no price" : unitsText(pick.units)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {graded.length > 40 ? (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="block w-full border-t border-line/10 px-4 py-2.5 text-center font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5"
                  >
                    {showAll ? "Show latest 40" : `Show all ${graded.length} graded picks`}
                  </button>
                ) : null}
              </>
            )}
          </Panel>

          <Panel>
            <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">How the model works</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
              <li>
                Rates every team from its regulation goals for and against and its shots on goal for and against, blending this season with 15
                games of last season so it works from opening night.
              </li>
              <li>
                The opponent&apos;s expected starter (most starts this season) counts through his save % over several seasons, pulled toward league
                average. Back-to-backs and 3+ days&apos; rest are included.
              </li>
              <li>
                Expected goals feed a final-score model (an overtime or shootout winner gets one more goal), and each market&apos;s probability is
                recalibrated from past seasons. Finished games are graded with what the model knew before puck drop.
              </li>
              <li>
                Every game gets a call on all three markets: the winner, a puck-line side and over / under. Those are leans, graded at their posted
                prices so the record is complete. A pick without a price shows &quot;no price&quot; and earns no units.
              </li>
              <li>
                ◆ Tracked edges: the side where the model beats the no-vig opening moneyline by {Math.round(TRACK_EDGE * 100)}+ points, 1 unit at
                the opening price. It made money before 2023 and the line moved toward it about 3 times in 4, but it lost against DraftKings in
                2025-26, so it is tracked, not a ★ best bet, until this season&apos;s record proves it. Only games where ESPN reports an opening
                line count.
              </li>
              <li>Not modeled: injuries and confirmed starting goalies. Past results don&apos;t guarantee future ones.</li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
