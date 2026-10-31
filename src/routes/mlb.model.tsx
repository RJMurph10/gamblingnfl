import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { gradeMlbSeason, winPct, type MlbRecord } from "@/lib/mlb/mlb-model";
import { useMlbSchedule } from "@/lib/mlb/use-mlb";

export const Route = createFileRoute("/mlb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingMLB" },
      {
        name: "description",
        content: "How the MLB model works and what 14 seasons of closing lines say about it.",
      },
    ],
  }),
  component: MlbModelPage,
});

/** Log loss of the research model and the closing line, by season (lower is better). */
const SEASONS: [number, number, number, number][] = [
  [2012, 2421, 0.6818, 0.6766],
  [2013, 2421, 0.6835, 0.6757],
  [2014, 2419, 0.6828, 0.6767],
  [2015, 2421, 0.6845, 0.6762],
  [2016, 2410, 0.6805, 0.6732],
  [2017, 2418, 0.6796, 0.6744],
  [2018, 2418, 0.6742, 0.6705],
  [2019, 2404, 0.6738, 0.6641],
  [2020, 786, 0.6758, 0.671],
  [2021, 2296, 0.6772, 0.6701],
  [2022, 2152, 0.6764, 0.6696],
  [2023, 2204, 0.6831, 0.6814],
  [2024, 2204, 0.6799, 0.6742],
  [2025, 1679, 0.6805, 0.6771],
];

/** Angle, games, units 2012–18, units 2019–25, hit rate. */
const ANGLES: [string, number, number, number, number][] = [
  ["Wrigley Field, wind blowing out 10+ mph → over", 125, 10.6, 5.4, 59.2],
  ["Model total at least 1 run under the line → under", 941, 8.6, 2.3, 53.7],
  ["Wrigley Field, wind blowing in 10+ mph → under", 181, 1.0, 1.3, 53.0],
  ["Wind blowing out 10+ mph (all parks) → over", 3737, -66.6, -81.9, 50.4],
  ["Wind blowing in 10+ mph (all parks) → under", 1788, -53.9, -12.6, 50.5],
  ["88°F or hotter outdoors → over", 2324, 8.7, -46.6, 51.6],
  ["50°F or colder → under", 817, -23.3, 0.2, 50.9],
  ["Umpire whose games run over → over", 13164, -403.4, -300.5, 49.7],
  ["Totals 10.5+ → under", 1785, -17.7, 4.5, 52.2],
  ["Home underdogs +130 or longer", 3852, -121.7, 49.6, 38.3],
  ["Road underdogs +150 or longer", 6741, -153.3, -89.2, 34.3],
  ["Home favorites −200 or shorter", 3610, 6.8, -37.8, 70.1],
  ["Fade a team on a 6+ game win streak", 582, 21.9, -8.3, 44.2],
  ["April home underdogs", 1181, -52.2, -12.5, 41.7],
  ["Model moneyline edge 6%+ (road)", 6651, -216.0, -36.4, 36.5],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;

const rec = (r: MlbRecord) => `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}`;
const pct = (r: MlbRecord) => {
  const v = winPct(r);
  return v === null ? "—" : v.toFixed(1);
};

/** Betting every game the model projects, at the closing prices. Shown for transparency. */
function EveryPick() {
  const { games, isLoading } = useMlbSchedule(60_000);
  const g = useMemo(() => gradeMlbSeason(games), [games]);
  const all = g.moneyline.units + g.runLine.units + g.total.units;
  const tone = (n: number) => (n > 0 ? "win" : n < 0 ? "loss" : "mute") as "win" | "loss" | "mute";
  const loading = isLoading ? "Loading…" : undefined;
  return (
    <Panel>
      <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
        If you bet every game
      </h2>
      <p className="mt-1 text-sm text-mute">
        One unit on the model&apos;s side of every moneyline, run line and total this season, at the
        closing prices. This is why only proven angles get a ★: betting everything loses about the
        sportsbook&apos;s cut.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Moneyline"
          value={pct(g.moneyline)}
          unit="%"
          note={loading ?? `${rec(g.moneyline)} · ${u(g.moneyline.units)}`}
          tone={tone(g.moneyline.units)}
        />
        <StatCard
          label="Totals"
          value={pct(g.total)}
          unit="%"
          note={loading ?? `${rec(g.total)} · ${u(g.total.units)}`}
          tone={tone(g.total.units)}
        />
        <StatCard
          label="Run line"
          value={pct(g.runLine)}
          unit="%"
          note={loading ?? `${rec(g.runLine)} · ${u(g.runLine.units)}`}
          tone={tone(g.runLine.units)}
        />
        <StatCard
          label="Every pick"
          value={u(all)}
          note={loading ?? `${g.games} games graded`}
          tone={tone(all)}
        />
      </div>
    </Panel>
  );
}

function MlbModelPage() {
  return (
    <>
      <PageTitle eyebrow="MLB" title="Model" />
      <div className="space-y-6">
        <EveryPick />
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            The short version
          </h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              We tested a pitcher-driven model on every game from 2012 to 2025 (about 32,000 games
              with closing lines). The closing line was more accurate in{" "}
              <b>every one of the 14 seasons</b>, and betting the model&apos;s edges at the close
              lost 2–4% at every edge size, on moneylines and totals alike. Next to the market, the
              model added nothing.
            </p>
            <p>
              So the MLB pages show the model&apos;s numbers as reference only. There are no ★ best
              bets for baseball. The one angle that held up in both halves of the test is on the
              watch list below.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            How the model on the game pages works
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            <li>
              <b>Expected runs</b> for each team: league runs per game × the team&apos;s offense
              (runs scored this season, with 20 games of league average mixed in) × the other
              side&apos;s pitching (55% the probable starter&apos;s ERA, halfway to league average;
              45% that team&apos;s runs allowed) × the ballpark (runs in the home team&apos;s home
              games vs its road games, with 40 games of neutral mixed in) × home field (+1.5% home,
              −1.5% road).
            </li>
            <li>
              <b>Run distributions</b> are negative binomial (runs vary more than a simple Poisson),
              with the spread fitted on 2012–2025. Ties after nine go to extra innings, which the
              home team wins 50.5% of the time, always by one run.
            </li>
            <li>
              That gives the <b>moneyline, run line and total</b> chances, compared with the
              sportsbook&apos;s no-vig prices.
              <b> First five innings</b> lean 85% on the starters, using each side&apos;s real share
              of its runs scored in innings 1–5.
            </li>
          </ul>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Research model vs the closing line" />
          <div className="px-4 pb-4">
            <p className="mb-3 text-sm text-mute">
              The research model is richer than the one above: starter strikeout, walk and home-run
              rates and quality (decayed over recent starts), expected starter depth, bullpen, the
              opposing lineup, park factors and day/night, refit each season using only earlier
              seasons. Log loss, lower is better (a coin flip is 0.6931).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="py-2 font-normal">Season</th>
                    <th className="py-2 text-right font-normal">Games</th>
                    <th className="py-2 text-right font-normal">Model</th>
                    <th className="py-2 text-right font-normal">Closing line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5 font-mono tabular-nums">
                  {SEASONS.map(([s, n, m, k]) => (
                    <tr key={s}>
                      <td className="py-1.5">{s}</td>
                      <td className="py-1.5 text-right text-mute">{n.toLocaleString()}</td>
                      <td className="py-1.5 text-right text-loss">{m.toFixed(4)}</td>
                      <td className="py-1.5 text-right text-win">{k.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5">All</td>
                    <td className="py-1.5 text-right">32,180</td>
                    <td className="py-1.5 text-right">0.6797</td>
                    <td className="py-1.5 text-right">0.6737</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Angle lab" />
          <div className="px-4 pb-4">
            <p className="mb-3 text-sm text-mute">
              Each angle was found on 2012–2018 and had to hold up on 2019–2025, at closing prices.
              Totals before 2022 are graded at −110 because the archive has no total prices.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                    <th className="py-2 font-normal">Angle</th>
                    <th className="py-2 text-right font-normal">Games</th>
                    <th className="py-2 text-right font-normal">2012–18</th>
                    <th className="py-2 text-right font-normal">2019–25</th>
                    <th className="py-2 text-right font-normal">Hit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/5">
                  {ANGLES.map(([a, n, d, c, h], i) => (
                    <tr key={a} className={i === 0 ? "bg-acc/5" : ""}>
                      <td className="py-1.5 pr-2">
                        {i === 0 ? (
                          <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-acc">
                            Watch
                          </span>
                        ) : null}
                        {a}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums text-mute">
                        {n.toLocaleString()}
                      </td>
                      <td
                        className={`py-1.5 text-right font-mono tabular-nums ${d > 0 ? "text-win" : "text-loss"}`}
                      >
                        {u(d)}
                      </td>
                      <td
                        className={`py-1.5 text-right font-mono tabular-nums ${c > 0 ? "text-win" : "text-loss"}`}
                      >
                        {u(c)}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{h.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-mute">
              Only the Wrigley wind-out over made money in both halves (59.2% over 125 games, about
              9 a season). It makes physical sense, but the sample is small, so it&apos;s a
              watch-list angle, not a ★.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">Props</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            <li>
              <b>Starting pitcher strikeouts:</b> projected batters faced × the pitcher&apos;s
              strikeout rate against the opposing lineup&apos;s. Off by 1.84 strikeouts on average
              across 59,000 starts, vs 1.85 for the pitcher&apos;s own average; correlation 0.43 vs
              0.41.
            </li>
            <li>
              <b>Batters:</b> home-run chances are well calibrated across the range; hit chances
              rank players correctly but run about 2.5 points low; total-bases projections are no
              better than a hitter&apos;s own average.
            </li>
            <li>
              There is no free history of prop lines, so these can&apos;t be tested for profit yet.
              Props are where books are softest, so saving lines once the season starts is the next
              step.
            </li>
          </ul>
        </Panel>

        <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
          Data: Retrosheet play-by-play and game logs 2010–2025 (2.8M plate appearances); closing
          lines from SportsbookReviewsOnline (2010–2021) and DraftKings/FanDuel (2022–2025). The
          information used here was obtained free of charge from and is copyrighted by Retrosheet
          (www.retrosheet.org).
        </p>
      </div>
    </>
  );
}
