/**
 * Model page watch list: weather angles tracked season by season, kept out of the picks until
 * they prove themselves on new games.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelHeader, TeamLogo } from "@/components/booth";
import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import { unitsText, type GameModelRow } from "@/lib/game-model";
import { getAngleForecasts } from "@/lib/history.functions";
import type { HistoryGame } from "@/lib/model-history";
import {
  WATCH_ANGLES,
  angleRecord,
  buildWatchList,
  type AngleHit,
  type AngleRecord,
  type GameConditions,
} from "@/lib/watch-angles";

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const recordText = (r: AngleRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const toneOf = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");

function conditionsText(c: GameConditions) {
  const parts = [];
  if (c.temp !== null) parts.push(`${Math.round(c.temp)}°F`);
  if (c.wind !== null) parts.push(`${Math.round(c.wind)} mph wind`);
  return parts.join(" · ") + (c.source === "forecast" ? " (forecast)" : "");
}

function HitRow({ hit }: { hit: AngleHit }) {
  const away = teamById(hit.game.awayTeamId);
  const home = teamById(hit.game.homeTeamId);
  const s = gameScore(hit.game);
  const final = hit.game.status === "final";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="w-20 font-mono text-[11px] text-faint">
        {hit.season} · Wk {hit.game.week}
      </span>
      {away && home ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {final ? <span className="font-mono tabular-nums">{s.away}</span> : null}
          <TeamLogo team={away} className="size-5" />
          <span className="text-faint">@</span>
          <TeamLogo team={home} className="size-5" />
          {final ? <span className="font-mono tabular-nums">{s.home}</span> : null}
        </span>
      ) : null}
      <span className="font-mono">{hit.label}</span>
      <span className="font-mono text-[11px] text-mute">
        {hit.conditions ? conditionsText(hit.conditions) : hit.note}
      </span>
      <span
        className={`ml-auto font-mono text-[11px] uppercase ${
          hit.result === "win" ? "text-win" : hit.result === "loss" ? "text-loss" : "text-mute"
        }`}
      >
        {hit.result === "pending" ? "upcoming" : hit.result}
      </span>
    </li>
  );
}

export function WatchList({
  history,
  currentSeason,
  schedule,
  nextWeek,
  modelRuns = [],
}: {
  history: HistoryGame[];
  currentSeason: number;
  schedule: Game[];
  nextWeek: number | null;
  /** Model runs by season, for the quarterback-change angle. */
  modelRuns?: { season: number; rows: GameModelRow[] }[];
}) {
  // Forecasts for next week's games (the forecast only reaches about a week out).
  const upcoming = useMemo(
    () =>
      schedule
        .filter((g) => g.week === nextWeek && g.status === "scheduled" && g.kickoffIso)
        .slice(0, 16)
        .map((g) => ({
          id: g.id,
          homeTeamId: g.homeTeamId,
          venue: g.venue || undefined,
          kickoffIso: g.kickoffIso!,
        })),
    [schedule, nextWeek],
  );
  const forecastQuery = useQuery({
    queryKey: ["angle-forecasts", upcoming.map((g) => g.id).join(",")],
    queryFn: () => getAngleForecasts({ data: { games: upcoming } }),
    enabled: upcoming.length > 0,
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const forecasts = useMemo(() => forecastQuery.data ?? {}, [forecastQuery.data]);
  const list = useMemo(
    () => buildWatchList(history, currentSeason, schedule, forecasts, modelRuns),
    [history, currentSeason, schedule, forecasts, modelRuns],
  );

  return (
    <Panel padded={false}>
      <PanelHeader
        title="Watch list"
        aside={
          <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
            Tracked · not used in picks
          </span>
        }
      />
      <p className="px-4 pt-3 text-sm text-mute">
        Angles that looked promising in past seasons but haven&apos;t proven themselves. Every
        qualifying game is graded at 1 unit against the closing line. An angle joins the model only
        if it keeps winning on new games.
      </p>
      {history.length === 0 ? (
        <p className="px-4 py-6 text-center font-mono text-xs text-mute">Loading past seasons…</p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          {WATCH_ANGLES.map((angle) => {
            const hits = list.hits.filter((h) => h.angle === angle.id);
            const all = angleRecord(hits);
            const thisWeek = hits.filter((h) => h.result === "pending");
            const recent = hits.filter((h) => h.result !== "pending").slice(0, 6);
            return (
              <div key={angle.id} className="rounded-lg border border-line/10 bg-panel2/20 p-3">
                <h3 className="font-disp text-base font-semibold uppercase tracking-tight">
                  {angle.title}
                </h3>
                <p className="mt-0.5 text-[12px] text-mute">
                  Bet: {angle.bet}. {angle.why}
                </p>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                      <th className="py-1.5 font-normal">Season</th>
                      <th className="py-1.5 text-right font-normal">Record</th>
                      <th className="py-1.5 text-right font-normal">Win %</th>
                      <th className="py-1.5 text-right font-normal">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.seasons.map((season) => {
                      const r = angleRecord(hits.filter((h) => h.season === season));
                      return (
                        <tr key={season} className="border-b border-line/10">
                          <td className="py-1.5 font-mono">
                            {season}
                            {season === currentSeason ? " so far" : ""}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {recordText(r)}
                          </td>
                          <td className="py-1.5 text-right font-mono tabular-nums">
                            {r.winPct === null ? "—" : `${one(r.winPct)}%`}
                          </td>
                          <td
                            className={`py-1.5 text-right font-mono tabular-nums ${toneOf(r.units)}`}
                          >
                            {unitsText(r.units)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="py-1.5 font-mono font-semibold">All</td>
                      <td className="py-1.5 text-right font-mono font-semibold tabular-nums">
                        {recordText(all)}
                      </td>
                      <td className="py-1.5 text-right font-mono font-semibold tabular-nums">
                        {all.winPct === null ? "—" : `${one(all.winPct)}%`}
                      </td>
                      <td
                        className={`py-1.5 text-right font-mono font-semibold tabular-nums ${toneOf(all.units)}`}
                      >
                        {unitsText(all.units)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <p className="label-mono mt-3">This week</p>
                {thisWeek.length ? (
                  <ul>
                    {thisWeek.map((h) => (
                      <HitRow key={`${h.angle}-${h.game.id}`} hit={h} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12px] text-faint">
                    {forecastQuery.isLoading
                      ? "Checking kickoff forecasts…"
                      : "No games qualify on the current forecast."}
                  </p>
                )}

                <p className="label-mono mt-3">Most recent</p>
                {recent.length ? (
                  <ul>
                    {recent.map((h) => (
                      <HitRow key={`${h.angle}-${h.game.id}`} hit={h} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12px] text-faint">No qualifying games yet.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="px-4 pb-3 text-[11px] text-faint">
        Past weather is what was recorded at kickoff (nflverse); about 1 in 10 outdoor games has
        none and isn&apos;t counted. This week uses the National Weather Service forecast, which can
        change before kickoff. Warm/dome teams: {""}
        MIA, TB, JAX, CAR, ATL, NO, HOU, DAL, ARI, LV, LAR, LAC, SF, DET, MIN, IND. Quarterback
        changes use the model&apos;s QB ratings and nflverse&apos;s starters (projected about two
        weeks ahead).
      </p>
    </Panel>
  );
}
