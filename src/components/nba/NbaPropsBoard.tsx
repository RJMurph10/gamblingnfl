/** Player prop projections for one NBA game, plus DraftKings lines (when posted) with model edges. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { Chip, NbaLogo } from "@/components/nba/NbaBits";
import { STAT_LABEL, STAT_SHORT, pct, type NbaGame, type NbaGameRosterStat, type NbaPropOffer, type NbaStatKey } from "@/lib/nba/nba";
import { buildRatings, evaluateProp, predictGame, projectStat, ratingRows, type StatProjection } from "@/lib/nba/nba-model";
import { isRebStar, rebProjection } from "@/lib/nba/nba-reb-stars";
import { useNbaGameProps, useNbaGameRosterStats, useNbaPrior, useNbaRebStars, useNbaSchedule } from "@/lib/nba/use-nba";

const BOARD_STATS: NbaStatKey[] = ["pts", "reb", "ast", "fg3m", "pra"];
const MORE_STATS: NbaStatKey[] = ["stl", "blk", "tov", "pr", "pa", "ra"];

interface Projected {
  entry: NbaGameRosterStat;
  home: boolean;
  proj: Partial<Record<NbaStatKey, StatProjection>>;
  minutes: number | null;
}

function useProjections(game: NbaGame, entries: NbaGameRosterStat[] | undefined): Projected[] {
  const { games } = useNbaSchedule(false);
  const prior = useNbaPrior();
  return useMemo(() => {
    if (!entries) return [];
    const finals = games.filter((g) => g.status === "final" && g.part !== "pre" && g.home.score !== null);
    const table = buildRatings(finals, prior);
    const pred = predictGame(table, game.home.team.id, game.away.team.id);
    const rows = ratingRows(table);
    const offense = (id: string) => rows.find((r) => r.teamId === id)?.offense ?? table.avg;
    const factorFor = (home: boolean) => (home ? pred.home / offense(game.home.team.id) : pred.away / offense(game.away.team.id));
    return entries
      .map((entry) => {
        const home = entry.player.teamId === game.home.team.id;
        const factor = factorFor(home);
        const proj: Partial<Record<NbaStatKey, StatProjection>> = {};
        for (const k of [...BOARD_STATS, ...MORE_STATS, "min"] as NbaStatKey[]) {
          const p = projectStat(entry.log, entry.priorLog, k, k === "min" ? 1 : factor);
          if (p) proj[k] = p;
        }
        return { entry, home, proj, minutes: proj.min?.mean ?? null };
      })
      .filter((x) => Object.keys(x.proj).length > 0)
      .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  }, [entries, games, prior, game]);
}

const range = (p?: StatProjection) => (p ? `${p.p25.toFixed(0)}–${p.p75.toFixed(0)}` : "");

export function NbaPropsBoard({ game }: { game: NbaGame }) {
  const stats = useNbaGameRosterStats(game);
  const props = useNbaGameProps(game);
  const stars = useNbaRebStars();
  const projected = useProjections(game, stats.data);
  const [more, setMore] = useState(false);
  const [market, setMarket] = useState<NbaStatKey | "all">("all");
  const columns = more ? [...BOARD_STATS, ...MORE_STATS] : BOARD_STATS;

  const byPlayer = useMemo(() => new Map(projected.map((p) => [p.entry.player.id, p])), [projected]);

  const offers = useMemo(() => {
    const list = props.data?.offers ?? [];
    return list
      .map((o: NbaPropOffer) => {
        const p = byPlayer.get(o.playerId)?.proj[o.stat];
        const x = o.stat === "reb" ? stars.data?.inputs?.[o.playerId] : undefined;
        const star = o.stat === "reb" && isRebStar(x, o.line, o.underOdds) ? rebProjection(x!) : null;
        return { o, p, e: p ? evaluateProp(o.line, p, o.overOdds, o.underOdds) : null, star };
      })
      .filter((x) => market === "all" || x.o.stat === market)
      .sort(
        (a, b) =>
          Number(b.star != null) - Number(a.star != null) ||
          (b.e?.edge ?? -1) - (a.e?.edge ?? -1) ||
          (b.e?.prob ?? 0) - (a.e?.prob ?? 0),
      );
  }, [props.data, byPlayer, market, stars.data]);
  const starCount = offers.filter((x) => x.star != null).length;

  const loading = stats.isLoading;
  const teams = [game.away.team, game.home.team];

  return (
    <div className="space-y-6">
      <Panel padded={false}>
        <PanelHeader
          title="DraftKings lines vs. model"
          aside={
            <span className="label-mono">
              {props.isLoading
                ? "Loading lines…"
                : props.data?.available
                  ? `${offers.length} props${starCount ? ` · ${starCount} ★ rebound under${starCount === 1 ? "" : "s"}` : ""}`
                  : "None posted yet"}
            </span>
          }
        />
        {props.data?.available ? (
          <>
            <div className="flex flex-wrap gap-2 border-b border-line/10 px-4 py-3">
              <Chip active={market === "all"} onClick={() => setMarket("all")}>All</Chip>
              {BOARD_STATS.concat(MORE_STATS).map((s) => (
                <Chip key={s} active={market === s} onClick={() => setMarket(s)} title={STAT_LABEL[s]}>{STAT_SHORT[s]}</Chip>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Market</th>
                    <th className="px-2 py-2 text-right font-normal">Line</th>
                    <th className="px-2 py-2 text-right font-normal">Over</th>
                    <th className="px-2 py-2 text-right font-normal">Under</th>
                    <th className="px-2 py-2 text-right font-normal">Proj</th>
                    <th className="px-2 py-2 font-normal">Lean</th>
                    <th className="px-4 py-2 text-right font-normal">Edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {offers.slice(0, 120).map(({ o, p, e, star }) => (
                    <tr key={`${o.playerId}-${o.stat}-${o.line}`} className={star != null ? "bg-acc/[0.06] hover:bg-acc/10" : "hover:bg-line/5"}>
                      <td className="px-4 py-2">
                        <Link to="/nba/players/$playerId" params={{ playerId: o.playerId }} className="font-medium hover:text-acc">{o.playerName}</Link>
                        <span className="ml-2 font-mono text-[10px] text-faint">{o.teamAbbr}</span>
                      </td>
                      <td className="px-2 py-2 text-mute">
                        {star != null ? (
                          <span
                            className="mr-1 font-mono text-acc"
                            title={`★ Rebound under: projection ${star.toFixed(1)} is 10%+ below the line (season + last-10 rebounds per minute × recent minutes)`}
                          >
                            ★ Under
                          </span>
                        ) : null}
                        {o.market}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{o.line}</td>
                      <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{o.overOdds ?? "—"}</td>
                      <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{o.underOdds ?? "—"}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{p ? p.mean.toFixed(1) : "—"}</td>
                      <td className={`px-2 py-2 font-mono text-[11px] uppercase ${e ? (e.pick === "over" ? "text-win" : "text-loss") : "text-faint"}`}>
                        {e ? `${e.pick} · ${pct(e.prob, 0)}` : "no data"}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-[12px] tabular-nums ${e?.edge == null ? "text-faint" : e.edge > 0.03 ? "text-win" : e.edge < 0 ? "text-loss" : "text-mute"}`}>
                        {e?.edge == null ? "—" : `${e.edge > 0 ? "+" : ""}${(e.edge * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-faint">
              Edge = model chance of the lean minus the price&apos;s implied chance (vig not removed). ★ = rebound under: research
              projection 10%+ below the line, 8+ games, under priced −160 or better. A research tool, not betting advice.
            </p>
          </>
        ) : (
          <p className="px-4 py-6 text-center font-mono text-xs text-mute">
            {props.isLoading ? "Loading lines…" : "ESPN hasn't posted DraftKings props for this game yet — projections below still work."}
          </p>
        )}
      </Panel>

      {teams.map((team) => {
        const list = projected.filter((p) => p.entry.player.teamId === team.id);
        return (
          <Panel key={team.id} padded={false}>
            <PanelHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <NbaLogo team={team} className="size-6" />
                  {team.name}
                </span>
              }
              aside={
                team === teams[0] ? (
                  <button type="button" onClick={() => setMore((v) => !v)} className="font-mono text-[10px] uppercase tracking-wider text-acc">
                    {more ? "Fewer stats" : "More stats"}
                  </button>
                ) : null
              }
            />
            {!list.length ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">{loading ? "Loading rotation and game logs…" : "No game logs available for this team yet."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Player</th>
                      <th className="px-2 py-2 text-right font-normal" title="Projected minutes">MIN</th>
                      {columns.map((k) => (
                        <th key={k} className="px-2 py-2 text-right font-normal" title={STAT_LABEL[k]}>{STAT_SHORT[k]}</th>
                      ))}
                      <th className="px-4 py-2 text-right font-normal">GP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {list.map(({ entry, proj, minutes }) => {
                      const out = /out/i.test(entry.player.status ?? "");
                      return (
                        <tr key={entry.player.id} className={`hover:bg-line/5 ${out ? "opacity-50" : ""}`}>
                          <td className="px-4 py-2.5">
                            <Link to="/nba/players/$playerId" params={{ playerId: entry.player.id }} className="font-medium hover:text-acc">{entry.player.name}</Link>
                            <span className="ml-2 font-mono text-[10px] text-faint">{entry.player.position}</span>
                            {entry.player.status ? <span className={`ml-2 font-mono text-[9px] uppercase ${out ? "text-loss" : "text-mute"}`}>{entry.player.status}</span> : null}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums text-mute">{minutes ? minutes.toFixed(0) : "—"}</td>
                          {columns.map((k) => (
                            <td key={k} className="px-2 py-2.5 text-right font-mono tabular-nums">
                              {proj[k] ? (
                                <>
                                  <span>{proj[k]!.mean.toFixed(1)}</span>
                                  <span className="ml-1 text-[10px] text-faint">{range(proj[k])}</span>
                                </>
                              ) : "—"}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-faint">{proj.pts?.games ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        );
      })}
      <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
        Projection = recent games weighted most, last season filling in early on, nudged for the game&apos;s expected scoring. Small grey range = middle 50% of outcomes.
      </p>
    </div>
  );
}

/** This season's graded ★ rebound unders: the record and the latest picks. */
export function NbaRebStarsRecord() {
  const stars = useNbaRebStars();
  const f = stars.data;
  const [w, l, pu, units] = f?.record ?? [0, 0, 0, 0];
  const roi = w + l ? (units / (w + l)) * 100 : null;
  const recent = (f?.picks ?? []).slice(-8).reverse();
  return (
    <Panel padded={false}>
      <PanelHeader
        title="★ Rebound unders"
        aside={
          <span className="label-mono">
            {stars.isLoading
              ? "Loading…"
              : w + l
                ? `${w}-${l}${pu ? `-${pu}` : ""} · ${units > 0 ? "+" : ""}${units.toFixed(2)}u · ROI ${roi! > 0 ? "+" : ""}${roi!.toFixed(1)}%`
                : "No graded picks yet"}
          </span>
        }
      />
      <div className="space-y-2 px-4 py-3 text-sm text-mute">
        <p>
          <span className="font-semibold text-foreground">The under when a player&apos;s rebound projection is 10%+ below the line.</span>{" "}
          Projection = rebounds per minute (60% season, 40% last 10 games) × recent minutes, this season&apos;s games only,
          8+ games played; only when the under is priced −160 or better. Graded at DraftKings&apos; opening line:
          2066-1465 (+6.6%) in 2023-24, 838-689 (+1.2%) in 2024-25 and 215-150 (+7.3%) in 2025-26 through January.
        </p>
        <p className="font-mono text-[10px] text-faint">
          The −160 cut was picked after seeing those seasons (heavily juiced unders won often but lost money every season).
          Expect smaller returns than the backtest: about +1% to +5%.
        </p>
      </div>
      {recent.length ? (
        <div className="overflow-x-auto border-t border-line/10">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-2 py-2 font-normal">Player</th>
                <th className="px-2 py-2 font-normal">Game</th>
                <th className="px-2 py-2 text-right font-normal">Line</th>
                <th className="px-2 py-2 text-right font-normal">Under</th>
                <th className="px-2 py-2 text-right font-normal">Proj</th>
                <th className="px-4 py-2 text-right font-normal">Reb</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {recent.map((p) => (
                <tr key={`${p[1]}-${p[3]}`}>
                  <td className="px-4 py-2 font-mono text-[11px] text-mute" suppressHydrationWarning>
                    {new Date(p[0]).toLocaleDateString([], { month: "numeric", day: "numeric" })}
                  </td>
                  <td className="px-2 py-2">
                    {p[3]} <span className="font-mono text-[10px] text-faint">{p[4]}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] text-mute">{p[2]}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">u{p[5]}</td>
                  <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{p[6] ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">{p[7].toFixed(1)}</td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums ${p[9] === "win" ? "text-win" : p[9] === "loss" ? "text-loss" : "text-mute"}`}>
                    {p[8]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
