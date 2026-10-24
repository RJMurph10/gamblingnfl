/**
 * College model watch list: angles that look promising but haven't earned a ★ yet. Each is
 * graded on every qualifying game; one joins the best bets only if it keeps winning on new games.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { MatchupLink, Panel, PanelHeader, TeamLogo } from "@/components/booth";
import { CFB_WATCH_HISTORY } from "@/data/cfb-watch-history";
import { gameScore, type Game } from "@/data/games";
import { teamById } from "@/data/teams";
import {
  CFB_WATCH,
  addRecords,
  cfbRecord,
  cfbWatchHits,
  outdoorStadium,
  recordFromCounts,
  recordText,
  type CfbRecord,
  type CfbWatchHit,
} from "@/lib/cfb-model";
import { unitsText } from "@/lib/game-model";
import { getAngleForecasts } from "@/lib/history.functions";

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const toneClass = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");
const DAY = 86_400_000;

/**
 * Kickoff wind forecasts (mph) for the next six days' outdoor FBS games with a total. The
 * National Weather Service forecast reaches about a week out; requests go 16 games at a time.
 */
export function useCfbWindForecasts(games: Game[]) {
  const upcoming = useMemo(() => {
    const now = Date.now();
    return games
      .filter((g) => {
        if (g.fcs || g.status !== "scheduled" || !g.kickoffIso || !g.total || g.neutralSite)
          return false;
        const t = Date.parse(g.kickoffIso);
        return t > now && t < now + 6 * DAY && outdoorStadium(g.homeTeamId) !== null;
      })
      .map((g) => ({
        id: g.id,
        homeTeamId: g.homeTeamId,
        kickoffIso: g.kickoffIso!,
        ...outdoorStadium(g.homeTeamId)!,
      }));
  }, [games]);
  const chunks = useMemo(() => {
    const out: (typeof upcoming)[] = [];
    for (let i = 0; i < upcoming.length; i += 16) out.push(upcoming.slice(i, i + 16));
    return out;
  }, [upcoming]);
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ["cfb-wind", chunk.map((g) => g.id).join(",")],
      queryFn: () => getAngleForecasts({ data: { games: chunk } }),
      staleTime: 30 * 60_000,
      retry: 1,
    })),
  });
  const windByGame = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const r of results)
      for (const [id, c] of Object.entries(r.data ?? {})) out[id] = c?.wind ?? null;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(",")]);
  return { windByGame, loading: results.some((r) => r.isLoading) };
}

function HitRow({ hit }: { hit: CfbWatchHit }) {
  const g = hit.game;
  const away = teamById(g.awayTeamId);
  const home = teamById(g.homeTeamId);
  if (!away || !home) return null;
  const s = gameScore(g);
  const line = hit.line === 0 ? "PK" : hit.line > 0 ? `+${hit.line}` : String(hit.line);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="w-12 font-mono text-[11px] text-faint">Wk {g.week}</span>
      <span className="min-w-[150px]">
        <MatchupLink
          game={g}
          away={away}
          home={home}
          awayScore={g.status !== "scheduled" ? s.away : ""}
          homeScore={g.status !== "scheduled" ? s.home : ""}
        />
      </span>
      <span className="inline-flex items-center gap-1 font-mono">
        {hit.market === "total" ? (
          `Under ${hit.line}`
        ) : (
          <>
            <TeamLogo team={home} className="size-4" />
            {home.abbr} {line}
          </>
        )}
      </span>
      {hit.wind !== undefined ? (
        <span className="font-mono text-[11px] text-mute">
          {Math.round(hit.wind)} mph (forecast)
        </span>
      ) : null}
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

function RecordRow({ label, r, bold = false }: { label: string; r: CfbRecord; bold?: boolean }) {
  const empty = r.wins + r.losses + r.pushes === 0;
  return (
    <tr className="border-b border-line/10 last:border-0">
      <td className={`py-1.5 font-mono ${bold ? "font-semibold" : ""}`}>{label}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">{empty ? "—" : recordText(r)}</td>
      <td className="py-1.5 text-right font-mono tabular-nums">
        {r.winPct === null ? "—" : `${one(r.winPct)}%`}
      </td>
      <td className={`py-1.5 text-right font-mono tabular-nums ${toneClass(r.units)}`}>
        {empty ? "—" : unitsText(r.units)}
      </td>
    </tr>
  );
}

export function CfbWatchList({ games, season }: { games: Game[]; season: number }) {
  const { windByGame, loading } = useCfbWindForecasts(games);
  const hits = useMemo(() => cfbWatchHits(games, windByGame), [games, windByGame]);

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
        Angles that look promising but haven&apos;t earned a ★. Every qualifying game is graded at 1
        unit against the line, and an angle becomes a best bet only if it keeps winning on new
        games.
      </p>
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        {CFB_WATCH.map((angle) => {
          const mine = hits.filter((h) => h.angle === angle.id);
          const graded = mine.filter((h) => h.result !== "pending");
          const thisWeek = mine.filter((h) => h.game.status !== "final");
          const recent = [...graded].reverse().slice(0, 5);
          const past = CFB_WATCH_HISTORY[angle.id] ?? {};
          const span = (lo: number, hi: number) =>
            addRecords(
              Object.entries(past)
                .filter(([y]) => Number(y) >= lo && Number(y) <= hi)
                .map(([, c]) => recordFromCounts(c)),
            );
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
                    <th className="py-1.5 font-normal">Seasons</th>
                    <th className="py-1.5 text-right font-normal">Record</th>
                    <th className="py-1.5 text-right font-normal">Win %</th>
                    <th className="py-1.5 text-right font-normal">Units</th>
                  </tr>
                </thead>
                <tbody>
                  <RecordRow label={`${season} so far`} r={cfbRecord(graded)} bold />
                  {Object.keys(past).length ? (
                    <>
                      <RecordRow label="2018–25" r={span(2018, 2025)} />
                      <RecordRow label="2009–17" r={span(2009, 2017)} />
                    </>
                  ) : null}
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
                  {angle.id === "wind" && loading
                    ? "Checking kickoff forecasts…"
                    : angle.id === "wind"
                      ? "No outdoor game has a 10+ mph forecast yet."
                      : "No games qualify this week."}
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
                <p className="mt-1 text-[12px] text-faint">
                  {angle.id === "wind"
                    ? "Shows this week's forecasts only; past games' wind isn't stored yet."
                    : "No graded games yet."}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[11px] text-faint">
        Time zones and travel use each school&apos;s home stadium. Wind is the National Weather
        Service forecast for outdoor stadiums, which reaches about a week out and can change before
        kickoff; domes (Syracuse, UNLV, UTSA) and neutral sites are skipped.
      </p>
    </Panel>
  );
}
