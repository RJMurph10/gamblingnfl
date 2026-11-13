import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader } from "@/components/shared/booth";
import { CbaseEmpty, CbaseTeamLink, PickChip } from "@/components/cbase/CbaseBits";
import {
  american,
  dayLabel,
  etDay,
  noVig,
  pct,
  signed,
  startTime,
  teamName,
  type CbaseLine,
} from "@/lib/cbase/cbase";
import { useCbaseGame } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/games/$gameId")({
  head: () => ({ meta: [{ title: "Game — GamblingCBASE" }] }),
  component: CbaseGamePage,
});

function LineTable({
  open,
  close,
  homeName,
  awayName,
}: {
  open?: CbaseLine | null;
  close?: CbaseLine | null;
  homeName: string;
  awayName: string;
}) {
  const rows: [string, (l: CbaseLine) => string][] = [
    [`${awayName} ML`, (l) => american(l.mlA)],
    [`${homeName} ML`, (l) => american(l.mlH)],
    [`${homeName} no-vig win chance`, (l) => pct(noVig(l.mlH, l.mlA), 1)],
    [`${homeName} run line`, (l) => (l.rl == null ? "—" : `${signed(l.rl, 1)} ${american(l.rlH)}`)],
    [
      `${awayName} run line`,
      (l) => (l.rl == null ? "—" : `${signed(-l.rl, 1)} ${american(l.rlA)}`),
    ],
    [
      "Total",
      (l) => (l.tot == null ? "—" : `${l.tot} (o ${american(l.ov)} / u ${american(l.un)})`),
    ],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
          <th className="px-4 py-2 font-normal" />
          <th className="px-2 py-2 text-right font-normal">Open</th>
          <th className="px-4 py-2 text-right font-normal">Latest</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/5 font-mono text-xs">
        {rows.map(([label, f]) => (
          <tr key={label}>
            <td className="px-4 py-2 font-sans text-sm">{label}</td>
            <td className="px-2 py-2 text-right">{open ? f(open) : "—"}</td>
            <td className="px-4 py-2 text-right">{close ? f(close) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CbaseGamePage() {
  const { gameId } = Route.useParams();
  const { data, isLoading } = useCbaseGame(gameId);
  if (isLoading) return <CbaseEmpty>Loading the game…</CbaseEmpty>;
  if (!data)
    return <CbaseEmpty>That game isn&apos;t in the saved college baseball data.</CbaseEmpty>;
  const g = data.lined ?? data.upcoming!;
  const teams = data.teams;
  const homeName = teamName(teams, g.home, "homeName" in g ? g.homeName : undefined);
  const awayName = teamName(teams, g.away, "awayName" in g ? g.awayName : undefined);
  const final = data.lined != null;
  const m = g.m;
  return (
    <>
      <PageTitle
        eyebrow={`College baseball · ${dayLabel(etDay(g.start))} · ${startTime(g.start)}`}
        title={`${awayName} at ${homeName}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="grid grid-cols-[1fr_auto] gap-y-2 text-lg">
            <CbaseTeamLink
              teams={teams}
              teamKey={g.away}
              fallback={awayName}
              season={data.season}
              className="font-disp uppercase"
            />
            <span className="font-mono">{final ? data.lined!.ar : ""}</span>
            <CbaseTeamLink
              teams={teams}
              teamKey={g.home}
              fallback={homeName}
              season={data.season}
              className="font-disp uppercase"
            />
            <span className="font-mono">{final ? data.lined!.hr : ""}</span>
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
            {final ? "Final" : "Scheduled"}
          </p>
          {g.picks?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {g.picks.map((p) => (
                <PickChip key={p.k} pick={p} homeName={homeName} awayName={awayName} />
              ))}
            </div>
          ) : null}
        </Panel>
        <Panel padded={false}>
          <PanelHeader
            title="Model"
            aside={<span className="label-mono">from earlier games only</span>}
          />
          {m ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line/5 font-mono text-xs">
                <tr>
                  <td className="px-4 py-2 font-sans text-sm">Expected runs</td>
                  <td className="px-4 py-2 text-right">
                    {awayName} {m.a.toFixed(1)} · {homeName} {m.h.toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-sans text-sm">{homeName} win chance</td>
                  <td className="px-4 py-2 text-right">{pct(m.p, 1)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-sans text-sm">Total</td>
                  <td className="px-4 py-2 text-right">{m.t.toFixed(1)}</td>
                </tr>
                {g.ctx?.sph || g.ctx?.spa ? (
                  <tr>
                    <td
                      className="px-4 py-2 font-sans text-sm"
                      title="The NCAA posts no probable starters: each team's starter from its last game on the same kind of day (Fri / Sat / Sun / midweek)"
                    >
                      Projected starters
                    </td>
                    <td className="px-4 py-2 text-right">
                      {g.ctx.spa ?? "?"} · {g.ctx.sph ?? "?"}
                    </td>
                  </tr>
                ) : null}
                {g.ctx?.temp != null ? (
                  <tr>
                    <td className="px-4 py-2 font-sans text-sm">Weather at first pitch</td>
                    <td className="px-4 py-2 text-right">
                      {g.ctx.temp}°{g.ctx.wind != null ? ` · wind ${g.ctx.wind} mph` : ""}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-mute">
              No model numbers: one of the teams had too few earlier games.
            </p>
          )}
        </Panel>
      </div>
      <div className="mt-6">
        <Panel padded={false}>
          <PanelHeader
            title="Lines"
            aside={<span className="label-mono">{"book" in g ? g.book : ""}</span>}
          />
          <LineTable open={g.open} close={g.close} homeName={homeName} awayName={awayName} />
          <p className="px-4 py-3 text-sm text-mute">
            Watch picks are graded at the opening price: moneyline when the model is{" "}
            {pct(data.model.mlEdge)}+ over the no-vig opener, run line {pct(data.model.rlEdge)}+,
            total {pct(data.model.totEdge ?? 0.08)}+ (simulated).{" "}
            <Link to="/cbase/model" className="text-acc hover:underline">
              About the model
            </Link>
          </p>
        </Panel>
      </div>
    </>
  );
}
