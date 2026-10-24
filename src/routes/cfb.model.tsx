import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/booth";
import { CfbWatchList } from "@/components/CfbWatchList";
import { ModelBoard, type TrackSeason } from "@/components/ModelBoard";
import { CFB_HISTORY } from "@/data/cfb-best-bets-history";
import {
  CFB_RULES,
  addRecords,
  recordFromCounts,
  recordText,
  runCfbModel,
  type CfbRecord,
} from "@/lib/cfb-model";
import { MODEL_SETTINGS, summarizeModel, unitsText, type MarketRecord } from "@/lib/game-model";
import { useCfbSchedule } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCFB" },
      {
        name: "description",
        content:
          "GamblingCFB's game model: predicted spreads, totals and win probabilities for every FBS game, its ★ best bets, and its record in units.",
      },
    ],
  }),
  component: CfbModel,
});

const SEASON = 2026;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const toneClass = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");

const asMarketRecord = (r: CfbRecord): MarketRecord => ({
  wins: r.wins,
  losses: r.losses,
  pushes: r.pushes,
  winPct: r.winPct,
  units: r.units,
  roi: r.wins + r.losses + r.pushes ? (r.units / (r.wins + r.losses + r.pushes)) * 100 : null,
  pending: 0,
});

/** Past seasons' ★ best-bet records (fixed), newest first. */
const PAST: { season: number; rules: Record<string, CfbRecord>; all: CfbRecord }[] = Object.entries(
  CFB_HISTORY,
)
  .map(([year, rules]) => {
    const r = Object.fromEntries(
      CFB_RULES.map((rule) => [rule.id, recordFromCounts(rules[rule.id] ?? [0, 0, 0])]),
    );
    return { season: Number(year), rules: r, all: addRecords(Object.values(r)) };
  })
  .sort((a, b) => b.season - a.season);

function CfbModel() {
  const { games, isLoading } = useCfbSchedule(60_000);
  const rows = useMemo(() => runCfbModel(games), [games]);
  const trackRecord: TrackSeason[] = useMemo(
    () => [
      { label: `${SEASON} so far`, rows },
      ...PAST.map((p) => ({ label: String(p.season), fixed: { bets: asMarketRecord(p.all) } })),
    ],
    [rows],
  );
  const allTime = addRecords(PAST.map((p) => p.all));
  const winning = PAST.filter((p) => p.all.units > 0).length;
  // This season's ★ record by rule.
  const thisSeason = (rule: string) => {
    const picks = rows.flatMap((r) => r.picks).filter((p) => p.reason === rule);
    return summarizeModel(
      rows.map((r) => ({ ...r, picks: r.picks.filter((p) => p.reason === rule) })),
      "bets",
    ).overall.wins + picks.length >= 0
      ? summarizeModel(
          rows.map((r) => ({ ...r, picks: r.picks.filter((p) => p.reason === rule) })),
          "bets",
        ).overall
      : null;
  };

  const rules = (
    <Panel>
      <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
        The ★ best bet rules
      </h2>
      <p className="mt-1 text-sm text-mute">
        Each rule was looked for on 2009–2017 and then checked on 2018–2025, seasons it never saw,
        against the consensus closing line. Together: {recordText(allTime)},{" "}
        {one(allTime.winPct ?? 0)}%, {unitsText(allTime.units)} since 2009, {winning} of{" "}
        {PAST.length} seasons winning. Early-season unders were flat on the older seasons and only
        took off in 2018, so they&apos;re the least proven of the four. Dozens of other angles were
        tested and dropped (big underdogs, home dogs, byes, Thursday and #MACtion unders,
        conference-specific unders, altitude, domes, cold northern November games).
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CFB_RULES.map((rule) => {
          const now = thisSeason(rule.id);
          const past = addRecords(PAST.map((p) => p.rules[rule.id]));
          return (
            <div key={rule.id} className="rounded-lg border border-line/10 bg-panel2/20 p-3">
              <h3 className="font-disp text-base font-semibold uppercase tracking-tight">
                {rule.title}
              </h3>
              <p className="mt-1 text-sm">{rule.bet}</p>
              <p className="mt-1 text-[12px] text-mute">{rule.why}</p>
              <dl className="mt-2 space-y-0.5 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Found</dt>
                  <dd>{rule.found}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Confirmed</dt>
                  <dd className="text-win">{rule.tested}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">Since 2009</dt>
                  <dd className={toneClass(past.units)}>
                    {recordText(past)} · {unitsText(past.units)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-faint">{SEASON} so far</dt>
                  <dd className={toneClass(now?.units ?? 0)}>
                    {now ? `${now.wins}-${now.losses}${now.pushes ? `-${now.pushes}` : ""}` : "—"} ·{" "}
                    {unitsText(now?.units ?? 0)}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </Panel>
  );

  return (
    <ModelBoard
      rows={rows}
      loading={isLoading}
      eyebrow={`gcfb-anchored-v1 · flat 1 unit per pick`}
      trackRecord={trackRecord}
      trackRecordAside="Walk-forward · closing lines"
      trackRecordNote={`${SEASON} runs week by week with only the games before each week, the way it runs live. Past seasons show the ★ best bets only (consensus closing lines, FBS vs FBS regular season); the every-game calls start this season.`}
      calibrationSource="this season's games before the next slate"
      extraTop={rules}
      watchList={<CfbWatchList games={games} season={SEASON} />}
      howItWorks={
        <Panel>
          <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
            How the model works
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mute">
            <li>
              The same engine as GamblingNFL: it rates every FBS team&apos;s offense and defense
              from this season&apos;s final scores, adjusted for opponents and home field, then
              predicts each game&apos;s score, spread, total and win probability.
            </li>
            <li>
              Only games from earlier weeks are used to predict a week, so the record above is what
              it would have picked at the time. Teams need {MODEL_SETTINGS.minGamesPerTeam} games
              played before it makes calls on them (FCS opponents rarely get there).
            </li>
            <li>
              It starts from the betting line and moves off it only as far as its own disagreements
              have actually predicted results this season (the &quot;trust&quot; above). Every game
              gets a winner, a spread side and an over / under; those are leans, graded so the
              record is complete.
            </li>
            <li>
              ★ Best bets use the four college rules above instead of the NFL ones: road
              bounce-back, cross-country trips, early-season unders and service academies. A rule
              sets the side on its market. Bowls get every-game calls but no ★.
            </li>
            <li>
              Every pick risks {MODEL_SETTINGS.stake} unit. Spreads and totals are graded at{" "}
              {MODEL_SETTINGS.defaultPrice}; moneylines at their ESPN price. Picks for upcoming
              games can change until kickoff as the lines move.
            </li>
          </ul>
        </Panel>
      }
    />
  );
}
