import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { WcbbLogo } from "@/components/wcbb/WcbbBits";
import { BEST_TOTAL_EDGE, buildRatings, ratingRows } from "@/lib/wcbb/wcbb-model";
import { useWcbbSchedule } from "@/lib/wcbb/use-wcbb";

export const Route = createFileRoute("/wcbb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingWCBB" },
      {
        name: "description",
        content:
          "How the women's college basketball model works, its power ratings, and what five seasons of lines say about it: no steady edge on spreads, an edge on totals against the opening line.",
      },
    ],
  }),
  component: WcbbModelPage,
});

/** Season, ★ wins, ★ losses, ★ units (blended totals 4+ pts off the opener, graded at the opener). */
const BEST: [string, number, number, number][] = [
  ["2023-24", 163, 127, 21.2],
  ["2024-25", 209, 139, 51.0],
  ["2025-26", 128, 95, 21.4],
];

/** Season, ATS %, ATS picks, ATS units, O/U %, O/U picks, O/U units, model margin miss, line miss, model total miss, line total miss. */
const BACKTEST: [string, number, number, number, number, number, number, number, number, number, number][] = [
  ["2022-23", 52.2, 2526, -9.8, 53.8, 1378, 36.6, 9.97, 9.65, 12.89, 12.87],
  ["2023-24", 55.1, 1751, 89.4, 57.0, 1115, 97.3, 10.38, 10.27, 13.01, 13.07],
  ["2024-25", 49.9, 696, -33.5, 56.4, 346, 26.3, 10.22, 9.69, 12.7, 12.64],
  ["2025-26", 53.7, 592, 15.1, 51.4, 317, -5.8, 10.54, 9.87, 12.48, 12.29],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;
const BREAK_EVEN = 52.4;

function WcbbModelPage() {
  const { games, teams, conferences, rankings, isLoading } = useWcbbSchedule(60_000);
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
      <PageTitle eyebrow="Women's college basketball" title="Model" />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">The short version</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              The model rates every Division I team <b>per possession</b>: offense, defense and pace, adjusted for
              opponent and home court, with recent games counting more. It&apos;s the men&apos;s college basketball model,
              unchanged, tested on every women&apos;s D-I game from 2021-22 to 2025-26, predicting each game only from
              the games before it.
            </p>
            <p>
              <b>Totals against the opening line: an edge.</b> The projection is a 50/50 blend of the efficiency
              model and the market&apos;s own view of each team (ratings fit to earlier games&apos; closing lines).
              Once both teams have 3+ games, when that total is {BEST_TOTAL_EDGE}+ points from the opening total the
              pick went <b>163-127, 209-139 and 128-95</b> in the three seasons ESPN has openers for (2023-24 to
              2025-26): 500-361, 58.1%, +94 units. Break-even is 52.4%. At 3+ points it was 749-573 (56.7%), every
              season positive too. Against the <i>closing</i> total the same blended picks hit about 52%, so bet early.
              Those are the ★ best bets, and every total pick (2+ points off) is graded at the opener as well.
            </p>
            <p>
              <b>Spreads: no steady edge.</b> 4+ points off the opening spread went 55%, 48% and 53%: not every season,
              so not a ★.
            </p>
            <p>
              <b>Fewer games have lines.</b> ESPN shows lines for about half of women&apos;s games in 2023-24 and only
              15–20% the last two seasons (mostly the bigger matchups), so there are a few hundred ★ picks a season,
              not thousands. Limits are small.
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
            Honest caveats: three seasons and 861 bets, positive every season and at every edge size from 2 to 8
            points, so it isn&apos;t one lucky setting. Openers can come with low limits or move fast. No ★ picks in
            the first week or so of the season (the market view needs games). The site grades every ★ pick this
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
            Closing lines from ESPN (DraftKings, else ESPN BET); the efficiency model alone, before the market blend.
            Women&apos;s closing lines are softer than the men&apos;s (some seasons the model beat them), but not every
            season. The steady edge is at the open.
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
                        <Link to="/wcbb/teams/$teamId" params={{ teamId: t.id }} className="inline-flex items-center gap-2 hover:text-acc">
                          <WcbbLogo team={t} className="size-5" />
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
