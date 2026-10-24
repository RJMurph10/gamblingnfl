import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/booth";
import { ModelBoard } from "@/components/ModelBoard";
import type { Game } from "@/data/games";
import { getLiveSchedule, getPriorSeasonResults } from "@/lib/espn.functions";
import { MODEL_SETTINGS } from "@/lib/game-model";
import { getNflHistory } from "@/lib/history.functions";
import { useKickoffForecasts, WatchList } from "@/components/WatchList";
import { pastSeasonRuns, readHistory, runModelWithHistory } from "@/lib/model-history";

export const Route = createFileRoute("/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingNFL" },
      {
        name: "description",
        content:
          "GamblingNFL's game model: predicted spreads, totals and win probabilities, its picks against the line, and its record in units.",
      },
      { property: "og:title", content: "Model — GamblingNFL" },
      {
        property: "og:description",
        content: "Model picks, accuracy and units won at a flat stake.",
      },
    ],
  }),
  component: ModelPage,
});

function ModelPage() {
  const scheduleQuery = useQuery({
    queryKey: ["live-schedule"],
    queryFn: () => getLiveSchedule(),
    refetchInterval: 60_000,
    staleTime: 10_000,
    retry: 1,
  });
  const games: Game[] = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  // Last season's scores give the model a head start in the first weeks.
  const priorQuery = useQuery({
    queryKey: ["prior-season-results"],
    queryFn: () => getPriorSeasonResults(),
    staleTime: 12 * 60 * 60_000,
    retry: 1,
  });
  const priorSeason = useMemo(() => priorQuery.data ?? [], [priorQuery.data]);
  // Results since 2022 (nflverse): past seasons calibrate the model, so its trust in itself
  // rests on hundreds of graded games; this season's rows carry recorded kickoff weather.
  const historyQuery = useQuery({
    queryKey: ["nfl-history-v2"],
    queryFn: () => getNflHistory(),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const {
    games: allHistory,
    currentSeason,
    upcoming,
    qbRows,
  } = useMemo(() => readHistory(historyQuery.data), [historyQuery.data]);
  // QB games since 2020 feed the QB styles (scrambler vs pocket passer best bets).
  const runOptions = useMemo(() => ({ qbRows }), [qbRows]);
  const history = useMemo(
    () => allHistory.filter((h) => h.season < currentSeason),
    [allHistory, currentSeason],
  );
  // Next week's kickoff forecasts: 10+ mph wind makes the under a ★ best bet.
  const slateWeek = useMemo(() => {
    const open = games.filter((g) => g.status !== "final").map((g) => g.week);
    return open.length ? Math.min(...open) : null;
  }, [games]);
  const { forecasts } = useKickoffForecasts(games, slateWeek);
  // This season's starters (finished + projected) feed the quarterback ratings; its recorded
  // weather and the forecasts feed the wind best bets.
  const current = useMemo(
    () => ({
      season: currentSeason,
      games: allHistory.filter((h) => h.season === currentSeason),
      upcoming,
      forecasts,
    }),
    [allHistory, currentSeason, upcoming, forecasts],
  );
  const rows = useMemo(
    () => runModelWithHistory(games, priorSeason, history, current, runOptions),
    [games, priorSeason, history, current, runOptions],
  );
  const trackRecord = useMemo(() => {
    const past = pastSeasonRuns(history, runOptions);
    const lastPast = past.at(-1)?.season;
    return [
      { label: lastPast ? `${lastPast + 1} so far` : "This season", rows },
      ...past.map((r) => ({ label: String(r.season), rows: r.rows })).reverse(),
    ];
  }, [rows, history, runOptions]);
  const qbRuns = useMemo(
    () => [
      ...pastSeasonRuns(history, runOptions),
      ...(currentSeason ? [{ season: currentSeason, rows }] : []),
    ],
    [history, currentSeason, rows, runOptions],
  );

  // The watch list's "this week" slate: the next week that still has games to play.
  const nextWeek = useMemo(() => {
    const open = rows.filter((r) => r.game.status !== "final").map((r) => r.game.week);
    return open.length ? Math.min(...open) : null;
  }, [rows]);

  return (
    <ModelBoard
      rows={rows}
      loading={scheduleQuery.isLoading}
      eyebrow={`${MODEL_SETTINGS.version} · flat 1 unit per pick`}
      trackRecord={trackRecord}
      trackRecordAside="Same model · walk-forward · closing lines"
      trackRecordNote="Each past season is replayed week by week with only the games before each week, the way it would have run live. Winner = the team it expected to win; spread and over / under are its lean on every game against the closing line."
      calibrationSource="past seasons plus this one before the next slate"
      watchList={
        currentSeason ? (
          <WatchList
            history={allHistory}
            currentSeason={currentSeason}
            schedule={games}
            nextWeek={nextWeek}
            modelRuns={qbRuns}
          />
        ) : null
      }
      howItWorks={
        <Panel>
          <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
            How the model works
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
            <li>
              Rates every team&apos;s offense and defense from this season&apos;s final scores,
              adjusted for opponents and home field, then predicts each game&apos;s score. That
              gives a model spread, total and win probability. Yards-per-play and EPA ratings were
              tested over three seasons and didn&apos;t beat final scores, so they aren&apos;t used.
            </li>
            <li>
              Only games from earlier weeks are used to predict a week, so the record above is what
              the model would have picked at the time. Teams need {MODEL_SETTINGS.minGamesPerTeam}{" "}
              games played before it bets them.
            </li>
            <li>
              Starts from the betting line. Each week it checks, on earlier games only (every past
              season since 2023 plus this one), how much its disagreements with the closing line
              actually predicted the result, and moves its line off the market only that far (the
              &quot;trust&quot; above). It also learns how much its own ratings squeeze games toward
              even, and whether games have been running over or under the totals. Win chances start
              from the moneyline&apos;s no-vig price, so the winner call is the market&apos;s
              favorite unless the model has earned the right to disagree.
            </li>
            <li>
              Every game gets a call on all three markets: the winner, a spread side and over /
              under. Those are leans, graded so the record is complete.
            </li>
            <li>
              ★ Best bets: every underdog getting {MODEL_SETTINGS.bigUnderdogPts}+ points, against
              the spread (big favorites have been overrated in every season since 2022), and the
              under in every outdoor game with {MODEL_SETTINGS.windUnderMph}+ mph of wind at kickoff
              (469-361 since 2012; picked on 2012–2021 and confirmed on 2022–2026 games it had never
              seen). Upcoming wind uses the National Weather Service forecast; finished games use
              the wind recorded at kickoff. Past results don&apos;t guarantee future ones; the track
              record above keeps score.
            </li>
            <li>
              Every pick risks {MODEL_SETTINGS.stake} unit. Spreads and totals are graded at the
              standard {MODEL_SETTINGS.defaultPrice}; moneylines at their closing ESPN price. Pushes
              return the stake. Picks for upcoming games can change until kickoff as the lines move.
            </li>
          </ul>
        </Panel>
      }
    />
  );
}
