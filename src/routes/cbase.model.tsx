import { createFileRoute } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { pct, signed } from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCBASE" },
      {
        name: "description",
        content:
          "How the college baseball run-ratings model works and what three seasons of lines say about it: watch picks on moneylines and run lines, no edge on totals.",
      },
    ],
  }),
  component: CbaseModelPage,
});

/** Season, ML w, l, units, RL w, l, units: the season builder's replay (each game predicted from earlier games). */
const REPLAY: [number, number, number, number, number, number, number][] = [
  [2024, 340, 234, 27.9, 278, 239, 8.8],
  [2025, 155, 153, -0.6, 222, 215, 12.6],
  [2026, 58, 65, 9.6, 111, 109, 1.3],
];

/** Season, model total miss, opening total miss, closing total miss (runs, games with lines). */
const ACCURACY: [number, number, number, number][] = [
  [2024, 4.82, 4.79, 4.73],
  [2025, 4.57, 4.54, 4.44],
  [2026, 4.45, 4.36, 4.29],
];

const u = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;

function CbaseModelPage() {
  const { data } = useCbaseSeason();
  const fx = data?.effects ?? {};
  return (
    <>
      <PageTitle eyebrow="College baseball" title="Model" />
      <div className="space-y-6">
        <Panel>
          <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
            The short version
          </h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            <p>
              Every Division I team gets an <b>offense</b> and <b>defense</b> rating in runs per
              game, adjusted for opponents, plus a <b>home park</b> effect, refit every game day
              from that season&apos;s earlier games (recent games count more) and started from 70%
              of last season&apos;s rating. Home field, midweek games (weaker starters) and Friday
              games (aces) are adjusted for. Results come from the NCAA&apos;s scoreboard, every D-I
              game, since ESPN lists only about a third of them.
            </p>
            <p>
              <b>Watch picks, not ★.</b> Moneylines when the model&apos;s win chance is{" "}
              {pct(data?.model.mlEdge ?? 0.08)}+ over the no-vig opening moneyline, and run lines at{" "}
              {pct(data?.model.rlEdge ?? 0.05)}+, made money in each of the last three seasons. But
              the same rules lost money in 2025 and 2026 under slightly different model settings, so
              it isn&apos;t proven the way the college basketball ★ picks are. The next step is
              starting pitchers, the biggest thing the model doesn&apos;t know yet.
            </p>
            <p>
              <b>Totals: no edge.</b> The model&apos;s totals miss by more than the opening total
              every season, so it makes no total picks.
            </p>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Watch picks by season"
            aside={<span className="label-mono">graded at the opening price · 1u each</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  <th className="px-2 py-2 text-right font-normal">Moneyline</th>
                  <th className="px-2 py-2 text-right font-normal">Units</th>
                  <th className="px-2 py-2 text-right font-normal">Run line</th>
                  <th className="px-4 py-2 text-right font-normal">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {REPLAY.map(([s, mw, ml, mu, rw, rl, ru]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    <td className="px-2 py-2 text-right">
                      {mw}-{ml}
                    </td>
                    <td className={`px-2 py-2 text-right ${mu > 0 ? "text-win" : "text-loss"}`}>
                      {u(mu)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {rw}-{rl}
                    </td>
                    <td className={`px-4 py-2 text-right ${ru > 0 ? "text-win" : "text-loss"}`}>
                      {u(ru)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-mute">
            Every game predicted only from games before it. Lines are ESPN&apos;s: ESPN BET for
            2024–25, DraftKings for 2026, on the ~1,200–1,800 games a season ESPN priced. This
            season&apos;s picks are graded on the Games page as they finish.
          </p>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel padded={false}>
            <PanelHeader
              title="Totals vs the market"
              aside={<span className="label-mono">average miss, runs</span>}
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-normal">Season</th>
                  <th className="px-2 py-2 text-right font-normal">Model</th>
                  <th className="px-2 py-2 text-right font-normal">Opener</th>
                  <th className="px-4 py-2 text-right font-normal">Close</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {ACCURACY.map(([s, m, o, c]) => (
                  <tr key={s}>
                    <td className="px-4 py-2">{s}</td>
                    <td className="px-2 py-2 text-right text-loss">{m.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right">{o.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">{c.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel padded={false}>
            <PanelHeader
              title={`What the ratings learned (${data?.season ?? ""})`}
              aside={<span className="label-mono">runs per team per game</span>}
            />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                {(
                  [
                    ["Average runs per team", fx.mu?.toFixed(2)],
                    ["Home field", signed(fx.home, 2)],
                    ["Midweek (Mon–Thu)", signed(fx.midweek, 2)],
                    ["Friday (series openers)", signed(fx.fri, 2)],
                    ["Sunday", signed(fx.sun, 2)],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-4 py-2 font-sans text-sm">{k}</td>
                    <td className="px-4 py-2 text-right">{v ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
