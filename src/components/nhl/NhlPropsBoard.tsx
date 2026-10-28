/** Player props for one NHL game: DraftKings lines vs. the model, plus per-game projections for both rosters. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader } from "@/components/shared/booth";
import { Chip, NhlLogo } from "@/components/nhl/NhlBits";
import {
  americanText,
  posGroup,
  PROP_LABEL,
  PROP_SHORT,
  type NhlGame,
  type NhlPlayer,
  type NhlPropOffer,
  type NhlPropStat,
} from "@/lib/nhl/nhl";
import { evaluateAtLeastOne, evaluateProp, leagueRates, projectRate, type RateTable } from "@/lib/nhl/nhl-props";
import { useNhlGameProps, useNhlPlayerIndex } from "@/lib/nhl/use-nhl";

const STATS: NhlPropStat[] = ["goals", "assists", "points", "sog", "saves"];
const pct = (p: number, d = 0) => `${(p * 100).toFixed(d)}%`;

interface Row {
  offer: NhlPropOffer;
  mean: number | null;
  lean: string | null;
  leanTone: string;
  prob: number | null;
  edge: number | null;
  ev: number | null;
  fair: number | null;
}

function evaluate(offer: NhlPropOffer, player: NhlPlayer | undefined, rates: RateTable): Row {
  const proj = player ? projectRate(player, offer.stat, rates) : null;
  const none: Row = { offer, mean: null, lean: null, leanTone: "text-faint", prob: null, edge: null, ev: null, fair: null };
  if (!proj) return none;
  if (offer.kind === "yes") {
    const e = evaluateAtLeastOne(proj.mean, offer.overOdds);
    return { ...none, mean: proj.mean, lean: `yes · ${pct(e.prob)}`, leanTone: e.edge !== null && e.edge > 0 ? "text-win" : "text-mute", prob: e.prob, edge: e.edge, ev: e.ev, fair: e.fair };
  }
  if (offer.line === null) return { ...none, mean: proj.mean };
  const e = evaluateProp(offer.line, proj.mean, offer.overOdds, offer.underOdds);
  return {
    ...none,
    mean: proj.mean,
    lean: `${e.pick} · ${pct(e.prob)}`,
    leanTone: e.pick === "over" ? "text-win" : "text-loss",
    prob: e.prob,
    edge: e.edge,
    ev: e.ev,
    fair: e.fair,
  };
}

const edgeTone = (e: number | null) => (e === null ? "text-faint" : e > 0.03 ? "text-win" : e < 0 ? "text-loss" : "text-mute");

export function NhlPropsBoard({ game }: { game: NhlGame }) {
  const index = useNhlPlayerIndex();
  const props = useNhlGameProps(game);
  const [market, setMarket] = useState<NhlPropStat | "all">("all");

  const players = index.data?.players ?? [];
  const rates = useMemo(() => leagueRates(players), [players]);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const rows = useMemo(() => {
    return (props.data?.offers ?? [])
      .filter((o) => market === "all" || o.stat === market)
      .map((o) => evaluate(o, byId.get(o.playerId), rates))
      .sort((a, b) => (b.ev ?? -9) - (a.ev ?? -9) || (b.prob ?? 0) - (a.prob ?? 0));
  }, [props.data, byId, rates, market]);

  const teams = [game.away.team, game.home.team];
  const loadingPlayers = index.isLoading;

  return (
    <div className="space-y-6">
      <Panel padded={false}>
        <PanelHeader
          title="DraftKings lines vs. model"
          aside={
            <span className="label-mono">
              {props.isLoading ? "Loading lines…" : props.data?.available ? `${rows.length} props` : "None posted yet"}
            </span>
          }
        />
        {props.data?.available ? (
          <>
            <div className="flex flex-wrap gap-2 border-b border-line/10 px-4 py-3">
              <Chip active={market === "all"} onClick={() => setMarket("all")}>
                All
              </Chip>
              {STATS.map((s) => (
                <Chip key={s} active={market === s} onClick={() => setMarket(s)} title={PROP_LABEL[s]}>
                  {PROP_SHORT[s]}
                </Chip>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-normal">Player</th>
                    <th className="px-2 py-2 font-normal">Market</th>
                    <th className="px-2 py-2 text-right font-normal">Line</th>
                    <th className="px-2 py-2 text-right font-normal">Over / yes</th>
                    <th className="px-2 py-2 text-right font-normal">Under</th>
                    <th className="px-2 py-2 text-right font-normal">Proj</th>
                    <th className="px-2 py-2 font-normal">Lean</th>
                    <th className="px-2 py-2 text-right font-normal">Edge</th>
                    <th className="px-4 py-2 text-right font-normal">EV / 1u</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {rows.slice(0, 150).map(({ offer: o, mean, lean, leanTone, edge, ev }) => (
                    <tr key={`${o.playerId}-${o.stat}-${o.line ?? "yes"}`} className="hover:bg-line/5">
                      <td className="px-4 py-2">
                        <Link to="/nhl/players/$playerId" params={{ playerId: o.playerId }} className="font-medium hover:text-acc">
                          {o.playerName}
                        </Link>
                        <span className="ml-2 font-mono text-[10px] text-faint">{o.teamAbbr}</span>
                      </td>
                      <td className="px-2 py-2 text-mute">{o.market}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{o.line ?? "—"}</td>
                      <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{americanText(o.overOdds)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums text-mute">{americanText(o.underOdds)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{mean === null ? "—" : mean.toFixed(2)}</td>
                      <td className={`px-2 py-2 font-mono text-[11px] uppercase ${leanTone}`}>{lean ?? "no data"}</td>
                      <td className={`px-2 py-2 text-right font-mono text-[12px] tabular-nums ${edgeTone(edge)}`}>
                        {edge === null ? "—" : `${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}%`}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-[12px] tabular-nums ${edgeTone(ev)}`}>
                        {ev === null ? "—" : `${ev > 0 ? "+" : ""}${ev.toFixed(2)}u`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-faint">
              Edge = model chance of the lean minus the book&apos;s chance (vig removed when both prices are posted, otherwise the
              price&apos;s implied chance). EV is per 1u at the lean&apos;s price. A research tool, not betting advice.
            </p>
          </>
        ) : (
          <p className="px-4 py-6 text-center font-mono text-xs text-mute">
            {props.isLoading
              ? "Loading lines…"
              : props.isError
                ? "Couldn't load props right now. Projections below still work."
                : "ESPN hasn't posted DraftKings props for this game yet — projections below still work."}
          </p>
        )}
      </Panel>

      {teams.map((team) => {
        const roster = players.filter((p) => p.teamId === team.id && p.stats && p.stats.gp > 0);
        const skaters = roster
          .filter((p) => posGroup(p.position) !== "G")
          .map((p) => ({ p, pts: projectRate(p, "points", rates), g: projectRate(p, "goals", rates), a: projectRate(p, "assists", rates), sog: projectRate(p, "sog", rates) }))
          .filter((x) => x.pts)
          .sort((a, b) => (b.pts?.mean ?? 0) - (a.pts?.mean ?? 0))
          .slice(0, 14);
        const goalies = roster
          .filter((p) => posGroup(p.position) === "G")
          .sort((a, b) => (b.stats?.gp ?? 0) - (a.stats?.gp ?? 0))
          .slice(0, 2)
          .map((p) => ({ p, sv: projectRate(p, "saves", rates) }));
        return (
          <Panel key={team.id} padded={false}>
            <PanelHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <NhlLogo team={team} className="size-6" />
                  {team.name}
                </span>
              }
              aside={<span className="label-mono">per-game projection</span>}
            />
            {!skaters.length && !goalies.length ? (
              <p className="px-4 py-6 text-center font-mono text-xs text-mute">
                {loadingPlayers ? "Loading roster stats…" : "No player stats available for this team yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2 font-normal">Player</th>
                      <th className="px-2 py-2 text-right font-normal">G</th>
                      <th className="px-2 py-2 text-right font-normal">A</th>
                      <th className="px-2 py-2 text-right font-normal">PTS</th>
                      <th className="px-2 py-2 text-right font-normal">SOG</th>
                      <th className="px-2 py-2 text-right font-normal">SV</th>
                      <th className="px-4 py-2 text-right font-normal">GP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/5">
                    {[...skaters.map((x) => ({ p: x.p, g: x.g, a: x.a, pts: x.pts, sog: x.sog, sv: null as null })), ...goalies.map((x) => ({ p: x.p, g: null, a: null, pts: null, sog: null, sv: x.sv }))].map((x) => {
                      const out = /out/i.test(x.p.status ?? "");
                      const f = (v: { mean: number } | null) => (v ? v.mean.toFixed(2) : "—");
                      return (
                        <tr key={x.p.id} className={`hover:bg-line/5 ${out ? "opacity-50" : ""}`}>
                          <td className="px-4 py-2.5">
                            <Link to="/nhl/players/$playerId" params={{ playerId: x.p.id }} className="font-medium hover:text-acc">
                              {x.p.name}
                            </Link>
                            <span className="ml-2 font-mono text-[10px] text-faint">{x.p.position}</span>
                            {x.p.status ? <span className={`ml-2 font-mono text-[9px] uppercase ${out ? "text-loss" : "text-mute"}`}>{x.p.status}</span> : null}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">{f(x.g)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">{f(x.a)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">{f(x.pts)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">{f(x.sog)}</td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">{f(x.sv)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-faint">{x.p.stats?.gp ?? 0}</td>
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
        Projection = season per-game rate blended with the position average (8 games of prior), as a Poisson count. Not adjusted for
        the opponent, ice time, power play, lineup or who starts in goal.
      </p>
    </div>
  );
}
