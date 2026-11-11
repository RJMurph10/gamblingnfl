import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbbLogo } from "@/components/cbb/CbbBits";
import { BEST_TOTAL_EDGE, TOTAL_PICK_MIN, buildRatings, ratingRows, type CbbModelRow } from "@/lib/cbb/cbb-model";
import { BestBetsNow, type BestBetItem } from "@/components/shared/BestBetsNow";
import { LiveResults } from "@/components/shared/LiveResults";
import type { LivePick } from "@/lib/shared/live-results";
import { useCbbModel, useCbbSchedule } from "@/lib/cbb/use-cbb";

/** Live results rows (the "Latest graded" list follows the first row). */
const CBB_GROUPS = [
  { label: "★ Totals (6+ off the opener)", test: (p: LivePick) => p.best },
  { label: "★ Unders", test: (p: LivePick) => p.best && p.pick.startsWith("Under") },
  { label: "★ Overs", test: (p: LivePick) => p.best && p.pick.startsWith("Over") },
];

export const Route = createFileRoute("/cbb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCBB" },
      {
        name: "description",
        content:
          "How the men's college basketball model works, its power ratings, and what seven seasons of lines say about it: no edge on spreads, an edge on totals against the opening line.",
      },
    ],
  }),
  component: CbbModelPage,
});

/** Season, ★ wins, ★ losses, ★ units (totals 6+ pts off the opener, graded at the opener). */
const BEST: [string, number, number, number][] = [
  ["2023-24", 154, 111, 29.0],
  ["2024-25", 158, 118, 25.6],
  ["2025-26", 271, 188, 58.4],
];

/** Season, ATS %, ATS picks, ATS units, O/U %, O/U picks, O/U units, model margin miss, line miss, model total miss, line total miss. */
const BACKTEST: [string, number, number, number, number, number, number, number, number, number, number][] = [
  ["2020-21", 50.3, 1792, -71.9, 49.8, 1474, -72.7, 9.45, 9.07, 13.45, 13.07],
  ["2021-22", 51.8, 2475, -25.6, 51.0, 2071, -53.1, 8.94, 8.63, 13.32, 13.0],
  ["2022-23", 50.3, 1804, -70.5, 50.9, 1618, -44.9, 9.29, 8.87, 13.33, 12.96],
  ["2023-24", 50.7, 2678, -85.5, 50.5, 2260, -81.7, 9.19, 8.85, 13.25, 12.92],
  ["2024-25", 49.2, 2762, -165.6, 50.8, 2272, -67.0, 9.16, 8.79, 13.0, 12.66],
  ["2025-26", 51.0, 2760, -73.9, 49.4, 2679, -153.3, 9.29, 8.94, 13.84, 13.38],
];

/** Angle, games, hit rate, units, hit rate by season 2022-23 → 2025-26. */
const ANGLES: [string, number, number, number, [number, number, number, number]][] = [
  ["Rested favorite (2+ days off) vs an underdog on 0–1 days rest", 459, 55.3, 25.9, [57.3, 59.4, 56.3, 49.6]],
  ["Totals 129.5 or lower → over", 1230, 53.3, 20.5, [54.3, 52.4, 54.5, 43.7]],
  ["Spread 20+ → over", 1579, 52.4, -0.2, [51.9, 52.8, 52.2, 52.5]],
  ["Neutral site → under", 2932, 52.3, -3.5, [52.6, 51.4, 51.4, 53.9]],
  ["Road underdogs +10 to +14.5", 2561, 52.2, -6.6, [51.4, 50.1, 52.9, 55.0]],
  ["Underdogs of 20+ points", 1581, 52.1, -9.8, [56.2, 49.3, 51.4, 51.9]],
  ["Postseason → under", 459, 51.9, -4.6, [59.3, 51.7, 47.2, 49.5]],
  ["December underdogs", 3992, 51.1, -97.5, [52.9, 50.3, 49.7, 51.1]],
  ["Conference games → under", 14382, 49.6, -772.1, [47.4, 49.6, 49.9, 51.3]],
  ["Home favorites −10 to −14.5", 2561, 47.8, -226.2, [48.6, 49.9, 47.1, 45.0]],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;
const BREAK_EVEN = 52.4;

/** Conference tier for the ★ list (research/cbb/tiers.py): power 6, high-mid, low-major, or mixed. */
const POWER6 = new Set(["2", "4", "7", "8", "23", "21"]);
const HIGH_MID = new Set(["3", "44", "29", "62", "18"]);
const tierOf = (c: string) => (POWER6.has(c) ? "Power 6" : HIGH_MID.has(c) ? "Mid-major" : c ? "Low-major" : "");
function gameTier(r: CbbModelRow): string {
  const h = tierOf(r.game.home.team.confId);
  const a = tierOf(r.game.away.team.confId);
  return h && h === a ? h : "Non-conf mix";
}

function bestBetItems(rows: CbbModelRow[]): BestBetItem[] {
  return rows
    .filter((r) => r.best && r.game.status === "scheduled" && !r.game.nonDivisionI)
    .map((r) => {
      const b = r.best!;
      const dir = b.pick === "over" ? (1 as const) : (-1 as const);
      const edge = b.rule === "edge";
      return {
        id: r.game.id,
        matchup: `${r.game.away.team.abbr} @ ${r.game.home.team.abbr}`,
        when: r.game.date,
        pick: b.pick === "over" ? "Over" : "Under",
        open: edge ? b.line : (r.game.open?.total ?? null),
        now: r.game.odds?.total ?? null,
        model: edge ? Math.round((b.line + dir * b.edge) * 10) / 10 : null,
        dir,
        bestEdge: edge ? BEST_TOTAL_EDGE : undefined,
        minEdge: edge ? TOTAL_PICK_MIN : undefined,
        timing: edge ? ("now" as const) : null,
        note: edge ? gameTier(r) : "conference under (closing total)",
        shop: {
          home: r.game.home.team.name,
          away: r.game.away.team.name,
          market: "total" as const,
          side: b.pick === "over" ? ("over" as const) : ("under" as const),
        },
      };
    });
}

function CbbModelPage() {
  const { games, teams, conferences, rankings, isLoading } = useCbbSchedule(60_000);
  const modelRows = useCbbModel(games);
  const betItems = useMemo(() => bestBetItems(modelRows), [modelRows]);
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
      <PageTitle eyebrow="Men's college basketball" title="Model" />
      <BestBetsNow
        league="cbb"
        items={betItems}
        loading={isLoading}
        empty={`No ★ bets on the board. A total becomes a ★ when the model is ${BEST_TOTAL_EDGE}+ points off the opening total; openers usually post the day before.`}
        footnote={`Status compares the model with the total now: Still good = ${BEST_TOTAL_EDGE}+ points of edge left, Partly gone = ${TOTAL_PICK_MIN}-${BEST_TOTAL_EDGE}, Gone = less. 2023-26 ★ by tier: Power 6 65%, Mid-major 60%, Low-major 57.5%, Non-conf mix 54%.`}
      />
      <LiveResults
        league="cbb"
        groups={CBB_GROUPS}
        footnote="Recorded by the picks job (4 times a day) the first time a ★ appears, at that opening-day line; flat 1u at −110. Line moved our way: share of picks where the total moved toward the pick before tip, and the average move."
      />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">The short version</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              The model rates every Division I team <b>per possession</b>, the way KenPom does: offense, defense and
              pace, adjusted for opponent and home court, with recent games counting more. It was tested on every
              D-I game from 2019-20 to 2025-26, predicting each game only from the games before it.
            </p>
            <p>
              <b>Spreads and moneylines: no edge.</b> Against the closing line the model went 49–52% against the
              spread every season, and the closing spread missed the final margin by less than the model did.
            </p>
            <p>
              <b>Totals against the opening line: an edge.</b> The projection is a 50/50 blend of the efficiency
              model and the market&apos;s own view of each team (ratings fit to earlier games&apos; closing lines).
              Once both teams have 3+ games, when that total is {BEST_TOTAL_EDGE}+ points from the opening total the
              pick hit <b>58.1%, 57.2% and 59.0%</b> in the three seasons ESPN has openers for (2023-24 to 2025-26),
              +113 units on 1,000 bets. Break-even is 52.4%. Against the <i>closing</i> total the same picks hit about
              50%: the model spots where the total is going to move, so the bet has to be made early. Those are the ★
              best bets.
            </p>
            <p>
              <b>★ MAAC unders.</b> Some conferences&apos; games lean one way against the total. To test that
              honestly, each season only the conferences whose <i>earlier</i> seasons leaned under (53%+, p &lt; 0.10)
              were picked, then graded on the new season. MAAC conference games were picked every season and went
              322-253 under (56.0%) at the closing total from 2021-22 to 2025-26. At the opening total the one test
              season was about even, so these are graded at the closing total. Pace by conference (the Big Ten is slow,
              the SEC fast) is already in the lines: Big Ten overs hit 51.5%.
            </p>
            <p>
              <b>Every total pick is graded at the opener too.</b> The dashboard&apos;s Totals card counts every game
              where the model is 4+ points off the opening total: 53.2% from 2023-24 to 2025-26 (593-524, 606-542,
              822-714), the smallest edge that beat break-even every season. Graded at the closing total the same
              picks hit 48–50%, so the opening number is the one to bet.
            </p>
            <p>
              <b>Spreads against the opening line: a newer pick.</b> Against the closing spread the blend still hits
              49–52%. At 6+ points off the <i>opening</i> spread it went 51%, 55% and 57%; leaving out neutral-site games
              (mostly early-season tournaments, where the lines and ESPN&apos;s odds data are messiest) it went{" "}
              <b>60-45 (57.1%), 131-105 (55.5%) and 133-104 (56.1%)</b>, every season above break-even. That&apos;s the
              dashboard&apos;s spread pick from November 2026, graded at the opener. It was found by splitting the data,
              so its live record has to hold up before it&apos;s a ★. Every 6+ pick has been on the underdog. The model also
              adds each team&apos;s own home edge (how much it has beaten the closing spread at home in past seasons):
              the market gives every team about the same home court, but some buildings are worth more and some less.
              With it the rule went <b>60-36, 128-95 and 142-98 (59.0%)</b>. Returning minutes (roster turnover) was
              tested too and didn&apos;t help: the openers already know who left.
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
            Honest caveats: three seasons and 1,000 bets is a decent but not huge sample (58% is about three standard
            errors above break-even), and openers can come with low limits or move fast. Market blends from 30% to 60%
            and edges of 5–7 points were all profitable every season, so it isn&apos;t one lucky setting. No ★ picks
            in the first week or so of the season (the market view needs games). The site grades every ★ pick this
            season at its opening total.
          </p>
        </Panel>

        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">How it works</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            <li>
              <b>Possessions</b> come from each game&apos;s box score: field-goal attempts − offensive rebounds +
              turnovers + 0.475 × free-throw attempts, the two teams averaged.
            </li>
            <li>
              Every team gets an <b>offense and defense rating</b> (points per 100 possessions above or below the D-I
              average) and a <b>tempo rating</b> (possessions per game above or below average), adjusted for who they
              played and where.
            </li>
            <li>
              Ratings <b>start from last season</b> (75% kept, 70% of tempo, worth five games of evidence) and then
              follow this season, with a game&apos;s weight halving every 30 days so recent form counts more.
            </li>
            <li>
              <b>Home court is worth 4 points per 100 possessions</b> (about 2.8 points a game), nothing at neutral
              sites. Games against non-Division I schools count a quarter as much.
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
            Closing lines from ESPN (DraftKings, else ESPN BET). At the close the market is sharper than the model on
            both spreads and totals; the totals edge only exists at the open.
          </p>
        </Panel>

        <Panel padded={false}>
          <PanelHeader title="Angles tested" aside={<span className="label-mono">2022-23 → 2025-26 · break-even 52.4%</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Angle</th>
                  <th className="px-2 py-2 text-right font-normal">Games</th>
                  <th className="px-2 py-2 text-right font-normal">Hit</th>
                  <th className="px-2 py-2 text-right font-normal">Units</th>
                  <th className="px-4 py-2 text-right font-normal">By season</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5">
                {ANGLES.map(([name, n, hit, units, by]) => (
                  <tr key={name}>
                    <td className="px-4 py-2">{name}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-mute">{n}</td>
                    <td className={`px-2 py-2 text-right font-mono text-xs ${hit >= BREAK_EVEN ? "text-win" : "text-loss"}`}>{hit.toFixed(1)}%</td>
                    <td className={`px-2 py-2 text-right font-mono text-xs ${units > 0 ? "text-win" : "text-loss"}`}>{u(units)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-[11px]">
                      {by.map((p, i) => (
                        <span key={i} className={`ml-2 ${p >= BREAK_EVEN ? "text-win" : "text-loss"}`}>
                          {p.toFixed(1)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-mute">
            62 angles tested on four seasons of closing lines; the ten closest to an edge, plus two clear losers, are
            above. None cleared break-even in all four seasons. The top two won three seasons in a row and then lost
            last season, so they&apos;re on the watch list, not the best-bets list.
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
                        <Link to="/cbb/teams/$teamId" params={{ teamId: t.id }} className="inline-flex items-center gap-2 hover:text-acc">
                          <CbbLogo team={t} className="size-5" />
                          {rankings[t.id] ? <span className="font-mono text-[10px] text-acc">{rankings[t.id]}</span> : null}
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
              : "Per 100 possessions: offense = points scored, defense = points allowed, net = offense − defense (against an average Division I team on a neutral court). Tempo = possessions per game."}
          </p>
        </Panel>
      </div>
    </>
  );
}
