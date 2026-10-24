/**
 * College player projections for one game, next to DraftKings' lines when ESPN posts them.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Panel, PanelHeader, TeamLogo } from "@/components/booth";
import { useGamePropBoard } from "@/components/DraftKingsPropsBoard";
import type { Game } from "@/data/games";
import { teamById, type Team } from "@/data/teams";
import { getCfbGameProjections } from "@/lib/cfb.functions";
import {
  MARKET_FOR_STAT,
  STAT_SETTINGS,
  fairOdds,
  impliedProbability,
  type PlayerProjection,
  type ProjStat,
} from "@/lib/cfb-projections";
import type { LivePropOffer } from "@/lib/props.types";

type Tab = "passing" | "rushing" | "receiving" | "td";

const TABS: { key: Tab; label: string; stats: ProjStat[] }[] = [
  { key: "passing", label: "Passing", stats: ["passYds", "passTd"] },
  { key: "rushing", label: "Rushing", stats: ["rushYds", "rushAtt"] },
  { key: "receiving", label: "Receiving", stats: ["recYds", "rec"] },
  { key: "td", label: "Anytime TD", stats: [] },
];

const fmt = (n: number, stat: ProjStat) =>
  stat === "passTd" || stat === "rec" || stat === "rushAtt" ? n.toFixed(1) : String(Math.round(n));
const pct = (p: number) => `${Math.round(p * 100)}%`;

function PlayerCell({ p }: { p: PlayerProjection }) {
  const team = teamById(p.teamId);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {team ? <TeamLogo team={team} className="size-4" /> : null}
      <Link
        to="/cfb/players/$playerId"
        params={{ playerId: p.playerId }}
        className="truncate font-medium hover:text-acc"
      >
        {p.name}
      </Link>
      <span className="font-mono text-[10px] text-faint">{p.position}</span>
    </span>
  );
}

export function CfbProjections({ game, away, home }: { game: Game; away: Team; home: Team }) {
  const [tab, setTab] = useState<Tab>("passing");
  const query = useQuery({
    queryKey: ["cfb-projections", game.id],
    queryFn: () => getCfbGameProjections({ data: { gameId: game.id } }),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const props = useGamePropBoard(game, away, home);

  // DraftKings offers by player and market.
  const offers = useMemo(() => {
    const map = new Map<string, LivePropOffer>();
    for (const o of props.data?.offers ?? []) {
      if (o.kind === "milestone") continue;
      const key = `${o.playerId}|${o.market}`;
      if (!map.has(key)) map.set(key, o);
    }
    return map;
  }, [props.data]);

  const players = query.data?.players ?? [];
  const active = TABS.find((t) => t.key === tab)!;
  const rows =
    tab === "td"
      ? players
          .filter((p) => p.anytimeTd !== undefined)
          .sort((a, b) => (b.anytimeTd ?? 0) - (a.anytimeTd ?? 0))
          .slice(0, 16)
      : players
          .filter((p) => p.stats.some((s) => s.stat === active.stats[0]))
          .sort(
            (a, b) =>
              (b.stats.find((s) => s.stat === active.stats[0])?.median ?? 0) -
              (a.stats.find((s) => s.stat === active.stats[0])?.median ?? 0),
          );

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Player projections"
        aside={
          <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
            Median · 80% range · vs DraftKings
          </span>
        }
      />
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${
              tab === t.key
                ? "bg-acc/10 text-acc ring-acc/25"
                : "bg-panel2 text-mute ring-line/10 hover:text-acc"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {query.isLoading ? (
        <p className="px-4 py-8 text-center font-mono text-xs text-mute">
          Projecting from both teams&apos; box scores…
        </p>
      ) : !rows.length ? (
        <p className="px-4 py-8 text-center font-mono text-xs text-mute">
          No projections yet: players need at least 2 games this season.
        </p>
      ) : tab === "td" ? (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Player</th>
                <th className="px-2 py-2 text-right font-normal">Chance</th>
                <th className="px-2 py-2 text-right font-normal">Fair odds</th>
                <th className="px-2 py-2 text-right font-normal">DraftKings</th>
                <th className="px-4 py-2 text-right font-normal">Book implies</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {rows.map((p) => {
                const offer = offers.get(`${p.playerId}|Anytime TD`);
                const implied = impliedProbability(offer?.overOdds);
                const diff = implied === null ? null : (p.anytimeTd ?? 0) - implied;
                return (
                  <tr key={p.playerId} className="hover:bg-line/5">
                    <td className="px-4 py-2">
                      <PlayerCell p={p} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {pct(p.anytimeTd ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-mute">
                      {fairOdds(p.anytimeTd ?? 0)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {offer?.overOdds ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono tabular-nums ${
                        diff === null
                          ? "text-faint"
                          : diff > 0.05
                            ? "text-win"
                            : diff < -0.05
                              ? "text-loss"
                              : "text-mute"
                      }`}
                    >
                      {implied === null ? "—" : pct(implied)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2 font-normal">Player</th>
                {active.stats.map((stat) => (
                  <th key={stat} className="px-2 py-2 text-right font-normal" colSpan={2}>
                    {STAT_SETTINGS[stat].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/5">
              {rows.map((p) => (
                <tr key={p.playerId} className="hover:bg-line/5">
                  <td className="px-4 py-2">
                    <PlayerCell p={p} />
                  </td>
                  {active.stats.map((stat) => {
                    const s = p.stats.find((x) => x.stat === stat);
                    const offer = offers.get(`${p.playerId}|${MARKET_FOR_STAT[stat]}`);
                    const line = offer?.line;
                    const gap = s && line !== undefined ? s.median - line : null;
                    return [
                      <td key={`${stat}-p`} className="px-2 py-2 text-right font-mono tabular-nums">
                        {s ? (
                          <>
                            <span className="font-semibold">{fmt(s.median, stat)}</span>
                            {s.low !== undefined ? (
                              <span className="ml-1.5 text-[10px] text-faint">
                                {fmt(s.low, stat)}–{fmt(s.high!, stat)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>,
                      <td
                        key={`${stat}-l`}
                        className="px-2 py-2 text-right font-mono text-[11px] tabular-nums"
                      >
                        {line === undefined ? (
                          <span className="text-faint">no line</span>
                        ) : (
                          <span
                            className={
                              gap === null || Math.abs(gap) < 0.1 * line
                                ? "text-mute"
                                : gap > 0
                                  ? "text-win"
                                  : "text-loss"
                            }
                            title={`DraftKings ${line} (o ${offer?.overOdds ?? "—"} / u ${offer?.underOdds ?? "—"})`}
                          >
                            DK {line}
                            {gap !== null ? ` · ${gap > 0 ? "+" : ""}${fmt(gap, stat)}` : ""}
                          </span>
                        )}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 pb-3 pt-2 text-[11px] text-faint">
        From each player&apos;s games this season (recent games count more), nudged for the
        opponent&apos;s defense. Tested on past seasons: the actual result lands above the median
        about half the time and inside the range about 80% of the time. Green and red mark a line
        10%+ below or above the projection; that&apos;s information, not a tested edge, since
        there&apos;s no archive of past college prop lines to test against.
        {query.data
          ? ` Games used: ${home.abbr} ${query.data.gamesUsed[home.id] ?? 0}, ${away.abbr} ${
              query.data.gamesUsed[away.id] ?? 0
            }.`
          : ""}
      </p>
    </Panel>
  );
}
