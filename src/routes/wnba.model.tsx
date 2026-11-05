import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { WnbaLogo } from "@/components/wnba/WnbaBits";
import { BEST_TOTAL_EDGE, buildRatings, ratingRows } from "@/lib/wnba/wnba-model";
import { useWnbaSchedule } from "@/lib/wnba/use-wnba";

export const Route = createFileRoute("/wnba/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingWNBA" },
      {
        name: "description",
        content:
          "How the WNBA model works, its power ratings, and what eight seasons of lines say about it: no edge at the closing line, an edge on totals against the opening line.",
      },
    ],
  }),
  component: WnbaModelPage,
});

/** Season, ★ wins, ★ losses, ★ units (blended totals 3+ pts off the opener, graded at the opener). */
const BEST: [string, number, number, number][] = [
  ["2024", 55, 28, 22.0],
  ["2025", 55, 32, 18.0],
  ["2026", 54, 45, 4.1],
];

/** Season, ATS %, ATS picks, ATS units, O/U %, O/U picks, O/U units, model margin miss, line miss, model total miss, line total miss. */
const BACKTEST: [string, number, number, number, number, number, number, number, number, number, number][] = [
  ["2019", 55.7, 88, 5.5, 44.1, 68, -10.7, 9.78, 9.78, 12.94, 12.37],
  ["2020", 44.0, 84, -13.4, 59.5, 37, 5.0, 9.93, 9.29, 12.84, 13.1],
  ["2021", 52.0, 102, -0.8, 44.8, 58, -8.4, 9.96, 9.74, 12.37, 12.12],
  ["2022", 51.9, 104, -0.9, 53.8, 52, 1.5, 9.73, 9.52, 13.51, 13.38],
  ["2023", 54.8, 135, 6.3, 56.9, 51, 4.4, 9.79, 9.55, 13.74, 13.77],
  ["2024", 46.5, 155, -17.5, 46.3, 82, -9.5, 8.94, 8.39, 12.29, 12.04],
  ["2025", 49.7, 179, -9.1, 47.3, 91, -8.9, 10.69, 10.44, 13.2, 12.98],
  ["2026", 56.4, 172, 13.2, 46.5, 127, -14.4, 9.98, 9.85, 15.01, 14.74],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;
const BREAK_EVEN = 52.4;

function WnbaModelPage() {
  const { games, teams, conferences, isLoading } = useWnbaSchedule(60_000);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const ratings = useMemo(() => {
    const d1 = new Set([...teams.values()].filter((t) => t.confId && conferences.has(t.confId)).map((t) => t.id));
    return ratingRows(buildRatings(games.filter((g) => g.status === "final")), d1.size ? d1 : undefined);
  }, [games, teams, conferences]);
  const shown = ratings.filter((r) => {
    if (!q) return true;
    const t = teams.get(r.teamId);
    return t ? `${t.name} ${t.abbr} ${t.short}`.toLowerCase().includes(q.toLowerCase()) : false;
  });

  return (
    <>
      <PageTitle eyebrow="WNBA" title="Model" />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">The short version</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              The model rates every team <b>per possession</b>: offense, defense and pace, adjusted for opponent and
              home court, with recent games counting more. It was tested on every game from 2018 to 2026, predicting
              each game only from the games before it, the same way the college basketball model was built.
            </p>
            <p>
              <b>At the closing line: no edge.</b> Spreads and totals against the closing line came out about even
              over eight seasons, and the closing line missed the final score by less than the model did.
            </p>
            <p>
              <b>Totals against the opening line: an edge.</b> The projection is a 50/50 blend of the efficiency
              model and the market&apos;s own view of each team (ratings fit to earlier games&apos; closing lines).
              Once both teams have 3+ games, when that total is {BEST_TOTAL_EDGE}+ points from the opening total the
              pick went <b>55-28, 55-32 and 54-45</b> in the three seasons ESPN has openers for (2024 to 2026): 164-105,
              61%, +44 units. Break-even is 52.4%. Against the <i>closing</i> total the same picks hit about 50%: the
              model spots where the total is going to move, so the bet has to be made early. Those are the ★ best bets.
              College basketball shows the same pattern, which is good evidence it&apos;s real.
            </p>
            <p>
              <b>Why not spreads?</b> Against the opening spread the model was mixed: below 50% in 2024, above it in
              2025 and 2026. Not consistent enough for a ★.
            </p>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="★ Best bets by season" aside={<span className="label-mono">total {BEST_TOTAL_EDGE}+ pts off the opener · 1u at −110</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  <th className="px-2 py-2 text-right font-normal">Record</th>
                  <th className="px-2 py-2 text-right font-normal">Hit</th>
                  <th className="px-4 py-2 text-right font-normal">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {BEST.map(([s, w, l, units]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    <td className="px-2 py-2 text-right">{w}-{l}</td>
                    <td className={`px-2 py-2 text-right ${(w / (w + l)) * 100 >= BREAK_EVEN ? "text-win" : "text-loss"}`}>{((w / (w + l)) * 100).toFixed(1)}%</td>
                    <td className={`px-4 py-2 text-right ${units > 0 ? "text-win" : "text-loss"}`}>{u(units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-mute">
            Honest caveats: only three seasons have opening lines (269 bets), and the 3-point edge was picked after
            seeing them, so expect less going forward: something like 55–58% would still be very profitable. 2026 was
            the weakest season. WNBA limits are low and openers move fast. No ★ picks in the first week or so of the
            season (the market view needs games). The site grades every ★ pick at its opening total.
          </p>
        </Panel>

        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">How it works</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            <li>
              <b>Possessions</b> come from each game&apos;s box score: field-goal attempts − offensive rebounds +
              turnovers + 0.44 × free-throw attempts, the two teams averaged.
            </li>
            <li>
              Every team gets an <b>offense and defense rating</b> (points per 100 possessions above or below the
              league average) and a <b>tempo rating</b> (possessions per game above or below average), adjusted for
              who they played and where.
            </li>
            <li>
              Ratings <b>start from last season</b> (60% kept, 70% of tempo, worth five games of evidence; expansion
              teams start below average) and then follow this season, with a game&apos;s weight halving every 30 days
              so recent form counts more.
            </li>
            <li>
              <b>Home court is worth 4 points per 100 possessions</b> (about 1.6 points a game).
            </li>
            <li>
              Projected score = (average + offense + the opponent&apos;s defense ± home court) × expected possessions,
              then blended 50/50 with the <b>market&apos;s view</b>: each team&apos;s rating fit to its earlier games&apos;
              closing spreads and totals (recent ones count more).
            </li>
          </ul>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Against the closing line, by season" aside={<span className="label-mono">1u per pick at −110</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  <th className="px-2 py-2 text-right font-normal">Spread (2+ pt edge)</th>
                  <th className="px-2 py-2 text-right font-normal">Totals (3+ pt edge)</th>
                  <th className="px-4 py-2 text-right font-normal">Avg miss: model / line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {BACKTEST.map(([s, ats, an, au, ou, on, oup, me, le, tme, tle]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    <td className={`px-2 py-2 text-right ${au > 0 ? "text-win" : "text-loss"}`}>
                      {ats.toFixed(1)}% <span className="text-faint">({an})</span> {u(au)}
                    </td>
                    <td className={`px-2 py-2 text-right ${oup > 0 ? "text-win" : "text-loss"}`}>
                      {ou.toFixed(1)}% <span className="text-faint">({on})</span> {u(oup)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {me.toFixed(2)} / <span className="text-win">{le.toFixed(2)}</span> margin · {tme.toFixed(1)} /{" "}
                      <span className="text-win">{tle.toFixed(1)}</span> total
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            Closing lines from ESPN (Bet365 2018-19, DraftKings and Bet365 2020-23, ESPN BET 2024-25, DraftKings 2026).
            At the close the market is sharper than the model on both spreads and totals; the totals edge only exists
            at the open.
          </p>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Power ratings"
            aside={
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a team"
                aria-label="Find a team"
                className="w-40 rounded-full bg-panel2 px-3 py-1 font-mono text-[11px] ring-1 ring-line/10 placeholder:text-faint"
              />
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">#</th>
                  <th className="px-2 py-2 font-normal">Team</th>
                  <th className="px-2 py-2 text-right font-normal">Net</th>
                  <th className="px-2 py-2 text-right font-normal">Offense</th>
                  <th className="px-2 py-2 text-right font-normal">Defense</th>
                  <th className="px-2 py-2 text-right font-normal">Tempo</th>
                  <th className="px-4 py-2 text-right font-normal">Games</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {(all || q ? shown : shown.slice(0, 50)).map((r) => {
                  const t = teams.get(r.teamId);
                  if (!t) return null;
                  return (
                    <tr key={r.teamId} className="hover:bg-line/5">
                      <td className="px-4 py-1.5 font-mono text-xs text-faint">{r.rank}</td>
                      <td className="px-2 py-1.5">
                        <Link to="/wnba/teams/$teamId" params={{ teamId: t.id }} className="inline-flex items-center gap-2 hover:text-acc">
                          <WnbaLogo team={t} className="size-5" />
                          {t.short}
                          <span className="font-mono text-[10px] text-faint">{conferences.get(t.confId)?.short}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
                        {r.net >= 0 ? "+" : ""}
                        {r.net.toFixed(1)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">{r.offense.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">{r.defense.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-mute">{r.tempo.toFixed(1)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs text-mute">{r.games}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!all && !q && shown.length > 50 ? (
            <button type="button" onClick={() => setAll(true)} className="w-full py-3 font-mono text-[11px] uppercase tracking-wider text-acc">
              All {shown.length} teams
            </button>
          ) : null}
          <p className="px-4 py-3 font-mono text-[10px] text-faint">
            {isLoading
              ? "Loading…"
              : "Per 100 possessions: offense = points scored, defense = points allowed, net = offense − defense (against an average team on a neutral court). Tempo = possessions per game."}
          </p>
        </Panel>
      </div>
    </>
  );
}
