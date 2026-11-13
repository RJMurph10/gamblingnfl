import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import {
  CbaseEmpty,
  CbaseGamesTable,
  CbaseLogo,
  CbaseTeamLink,
  rowFromLined,
  rowFromUpcoming,
} from "@/components/cbase/CbaseBits";
import {
  cbaseDashStats,
  dayLabel,
  etDay,
  pickLabel,
  roi,
  signed,
  startTime,
  teamName,
  winShare,
  type CbaseRecord,
} from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/")({
  head: () => ({
    meta: [
      { title: "Season Pulse — GamblingCBASE dashboard" },
      {
        name: "description",
        content:
          "NCAA Division I baseball: the next games with their lines, the run-ratings model's numbers and watch picks, and the top teams.",
      },
    ],
  }),
  component: CbaseDashboard,
});

const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const note = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(" · ");
const unitsText = (u: number) => `${u > 0 ? "+" : ""}${u.toFixed(1)}u`;
const tone = (v: number | null, even: number): "win" | "loss" | "mute" =>
  v === null ? "mute" : v > even ? "win" : v < even ? "loss" : "mute";
const recText = (r: CbaseRecord) =>
  r.w + r.l
    ? note(
        `${r.w}-${r.l} · ${unitsText(r.u)}`,
        roi(r) !== null && `ROI ${roi(r)! > 0 ? "+" : ""}${roi(r)!.toFixed(1)}%`,
      )
    : "No picks graded yet";

function CbaseDashboard() {
  const { data, isLoading, isError } = useCbaseSeason();
  const teams = useMemo(() => data?.teams ?? {}, [data]);
  const upcoming = useMemo(
    () => (data?.upcoming ?? []).map((g) => rowFromUpcoming(g, teams)),
    [data, teams],
  );
  const days = useMemo(() => {
    const out: { day: string; rows: typeof upcoming }[] = [];
    for (const r of upcoming) {
      const day = etDay(r.start);
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out.slice(0, 3);
  }, [upcoming]);
  const recent = useMemo(
    () =>
      [...(data?.lined ?? [])]
        .filter((g) => g.picks?.length)
        .sort((a, b) => b.start.localeCompare(a.start))
        .slice(0, 12)
        .map((g) => rowFromLined(g, teams)),
    [data, teams],
  );
  const top = useMemo(
    () =>
      Object.entries(teams)
        .filter(([, t]) => t.rank)
        .sort((a, b) => a[1].rank! - b[1].rank!)
        .slice(0, 25),
    [teams],
  );
  const stats = useMemo(() => cbaseDashStats(data?.lined ?? []), [data]);
  const watch = useMemo(
    () =>
      (data?.upcoming ?? [])
        .filter((g) => g.picks?.length)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, 12),
    [data],
  );

  if (isLoading) return <CbaseEmpty>Loading college baseball…</CbaseEmpty>;
  if (isError || !data)
    return <CbaseEmpty>College baseball data couldn&apos;t be loaded right now.</CbaseEmpty>;

  const { ml, rl } = data.record;
  const winRate = winShare(stats.winner.right, stats.winner.wrong);
  const totRate = winShare(stats.totals.w, stats.totals.l);
  const clvRate = stats.clv.picks ? (stats.clv.ours / stats.clv.picks) * 100 : null;
  const through = stats.through
    ? new Date(`${stats.through}T12:00:00Z`).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <>
      <section className="mb-6">
        <PageTitle eyebrow={`Home dashboard · ${data.season} D-I season`} title="Season Pulse" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Win rate · model"
            value={fmt(winRate)}
            unit={winRate === null ? undefined : "%"}
            note={note(
              `${stats.winner.right}-${stats.winner.wrong} picking winners`,
              stats.winner.market !== null &&
                `opener's favorite ${stats.winner.market.toFixed(1)}%`,
            )}
            tone={tone(winRate, stats.winner.market ?? 50)}
          />
          <StatCard
            label="Totals · model"
            value={fmt(totRate)}
            unit={totRate === null ? undefined : "%"}
            note={note(
              `${stats.totals.w}-${stats.totals.l} O/U at the opening total`,
              "not a watch pick",
            )}
            tone={tone(totRate, 52.4)}
          />
          <StatCard
            label="Run lines · watch picks"
            value={fmt(winShare(rl.w, rl.l))}
            unit={rl.w + rl.l ? "%" : undefined}
            note={recText(rl)}
            tone={rl.u > 0 ? "win" : rl.u < 0 ? "loss" : "mute"}
          />
          <StatCard
            label="Moneylines · line moved our way"
            value={fmt(clvRate)}
            unit={clvRate === null ? undefined : "%"}
            note={
              stats.clv.picks
                ? `of ${stats.clv.picks} watch moneylines · against us ${((stats.clv.against / stats.clv.picks) * 100).toFixed(0)}%`
                : "Needs games with an opening and closing price"
            }
            tone={
              clvRate === null
                ? "mute"
                : stats.clv.ours > stats.clv.against
                  ? "win"
                  : stats.clv.ours < stats.clv.against
                    ? "loss"
                    : "mute"
            }
          />
          <StatCard
            label="Model edge · watch moneylines"
            value={unitsText(ml.u)}
            note={note(recText(ml), `every watch pick ${unitsText(ml.u + rl.u)}`)}
            tone={ml.u > 0 ? "win" : ml.u < 0 ? "loss" : "mute"}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-faint">
          {stats.graded} games graded{through ? ` through ${through}` : ""} · {data.lined.length}{" "}
          games with lines · flat 1u per pick at the opening price · ratings from earlier games only
          ·{" "}
          <Link to="/cbase/model" className="text-acc">
            How it works →
          </Link>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 space-y-6 lg:col-span-8">
          {days.length ? (
            days.map((d) => (
              <CbaseGamesTable
                key={d.day}
                title={dayLabel(d.day)}
                aside={`${d.rows.length} game${d.rows.length === 1 ? "" : "s"} with lines`}
                rows={d.rows}
                teams={teams}
              />
            ))
          ) : (
            <Panel>
              <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
                Upcoming games
              </h2>
              <p className="mt-3 font-mono text-xs text-mute">
                The season is over. College baseball runs mid-February to late June; the{" "}
                {data.season} season&apos;s games are under{" "}
                <Link to="/cbase/games" className="text-acc hover:underline">
                  Games
                </Link>
                .
              </p>
            </Panel>
          )}
          {recent.length ? (
            <CbaseGamesTable
              title="Latest watch picks"
              withDate
              rows={recent}
              teams={teams}
              season={data.season}
            />
          ) : null}
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Watch picks
            </h2>
            <p className="mt-2 text-sm text-mute">
              <span className="font-semibold text-foreground">
                Not ★ best bets yet. Moneylines {Math.round(data.model.mlEdge * 100)}%+ and run
                lines {Math.round(data.model.rlEdge * 100)}%+ off the no-vig opener.
              </span>{" "}
              Up +37u and +23u over 2024–26 (2025 moneylines about even), but the result depends on
              the model&apos;s settings, so they&apos;re tracked here while the model gets stronger
              (starting pitchers next).
            </p>
            <div className="mt-3 divide-y divide-line/5 rounded-lg border border-line/10">
              {watch.length ? (
                watch.flatMap((g) =>
                  (g.picks ?? []).map((p) => (
                    <div
                      key={`${g.espn}-${p.k}`}
                      className="flex items-center gap-2 px-3 py-2 font-mono text-[11px]"
                    >
                      <span className="min-w-0 flex-1 truncate" suppressHydrationWarning>
                        {teamName(teams, g.away, g.awayName)} @{" "}
                        {teamName(teams, g.home, g.homeName)} · {startTime(g.start)}
                      </span>
                      <span className="font-semibold text-foreground">
                        {pickLabel(
                          p,
                          teamName(teams, g.home, g.homeName),
                          teamName(teams, g.away, g.awayName),
                        )}
                      </span>
                      <span className="w-12 text-right text-mute">{signed(p.edge * 100, 0)}%</span>
                    </div>
                  )),
                )
              ) : (
                <p className="px-3 py-3 font-mono text-[11px] text-mute">
                  No watch picks on the board. They show up once a game&apos;s opening line is
                  posted.
                </p>
              )}
            </div>
            <Link
              to="/cbase/model"
              className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              How it works →
            </Link>
          </Panel>
          <Panel>
            <h2 className="font-disp text-xl font-semibold uppercase tracking-tight">
              Top 25 by the model
            </h2>
            <p className="label-mono mb-3">Runs per game vs average · tap to open</p>
            <div className="grid grid-cols-5 gap-2">
              {top.map(([key, t]) => (
                <Link
                  key={key}
                  to="/cbase/teams/$teamId"
                  params={{ teamId: key }}
                  search={{ season: data.season }}
                  title={`#${t.rank} ${t.name} (${t.w}-${t.l}) · ${signed((t.off ?? 0) + (t.dfn ?? 0), 2)} runs/game`}
                  className="glass relative grid aspect-square place-items-center rounded-xl ring-1 ring-line/10 hover:glow"
                >
                  <span className="absolute left-1 top-0.5 font-mono text-[9px] font-bold text-acc">
                    {t.rank}
                  </span>
                  <CbaseLogo team={t} className="size-8" />
                </Link>
              ))}
            </div>
            <Link
              to="/cbase/teams"
              className="mt-3 block text-center font-mono text-[10px] uppercase tracking-wider text-acc"
            >
              + all D-I teams
            </Link>
          </Panel>
          <Panel padded={false}>
            <PanelHeader
              title="Top 10 ratings"
              aside={<span className="label-mono">runs / game</span>}
            />
            <div className="divide-y divide-line/5">
              {top.slice(0, 10).map(([key, t]) => (
                <div key={key} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-4 font-mono text-[10px] text-faint">{t.rank}</span>
                  <CbaseLogo team={t} className="size-5" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <CbaseTeamLink
                      teams={teams}
                      teamKey={key}
                      season={data.season}
                      showRank={false}
                    />
                  </span>
                  <span className="font-mono text-[10px] text-faint">
                    {t.w}-{t.l}
                  </span>
                  <span className="w-12 text-right font-mono text-xs tabular-nums">
                    {signed((t.off ?? 0) + (t.dfn ?? 0), 2)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
      <p className="mt-6 font-mono text-[10px] text-faint">
        Results: NCAA scoreboard. Lines: ESPN (ESPN BET, then DraftKings). Updated{" "}
        {new Date(data.updated).toLocaleString()}.
      </p>
    </>
  );
}
