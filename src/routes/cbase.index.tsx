import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import {
  CbaseEmpty,
  CbaseGamesTable,
  CbaseTeamLink,
  rowFromLined,
  rowFromUpcoming,
} from "@/components/cbase/CbaseBits";
import { dayLabel, etDay, recordText, signed } from "@/lib/cbase/cbase";
import { useCbaseSeason } from "@/lib/cbase/use-cbase";

export const Route = createFileRoute("/cbase/")({
  head: () => ({
    meta: [
      { title: "College Baseball — GamblingCBASE" },
      {
        name: "description",
        content:
          "NCAA Division I baseball: the next games with their lines, the run-ratings model's numbers and watch picks, and the top teams.",
      },
    ],
  }),
  component: CbaseDashboard,
});

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

  if (isLoading) return <CbaseEmpty>Loading college baseball…</CbaseEmpty>;
  if (isError || !data)
    return <CbaseEmpty>College baseball data couldn&apos;t be loaded right now.</CbaseEmpty>;

  return (
    <>
      <PageTitle eyebrow={`NCAA Division I · ${data.season} season`} title="College Baseball" />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Watch moneylines" value={recordText(data.record.ml)} />
        <StatCard label="Watch run lines" value={recordText(data.record.rl)} />
        <StatCard label="Games with lines" value={String(data.lined.length)} />
      </div>
      <Panel className="mb-6">
        <p className="text-sm leading-relaxed text-foreground/90">
          <b>Watch picks, not ★ best bets.</b> The model rates every D-I team from runs scored and
          allowed. Its moneyline (8%+ off the no-vig opener) and run-line (5%+) picks were up +37u
          and +23u over 2024–26 (2025 moneylines about even), but the result depends on the
          model&apos;s settings, so they&apos;re tracked here while the model gets stronger
          (starting pitchers next).{" "}
          <Link to="/cbase/model" className="text-acc hover:underline">
            How it works →
          </Link>
        </p>
      </Panel>
      {days.length ? (
        <div className="mb-6 space-y-6">
          {days.map((d) => (
            <CbaseGamesTable
              key={d.day}
              title={dayLabel(d.day)}
              aside={`${d.rows.length} game${d.rows.length === 1 ? "" : "s"} with lines`}
              rows={d.rows}
              teams={teams}
            />
          ))}
        </div>
      ) : (
        <CbaseEmpty>
          No games this week. The college baseball season runs mid-February to late June; the{" "}
          {data.season} season&apos;s games are under Games.
        </CbaseEmpty>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        {recent.length ? (
          <CbaseGamesTable
            title="Latest watch picks"
            withDate
            rows={recent}
            teams={teams}
            season={data.season}
          />
        ) : (
          <div />
        )}
        <Panel padded={false}>
          <PanelHeader
            title="Top 25 by the model"
            aside={<span className="label-mono">runs per game vs average</span>}
          />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line/5">
              {top.map(([key, t]) => (
                <tr key={key}>
                  <td className="w-8 px-4 py-1.5 font-mono text-xs text-faint">{t.rank}</td>
                  <td className="py-1.5">
                    <CbaseTeamLink
                      teams={teams}
                      teamKey={key}
                      season={data.season}
                      showRank={false}
                    />
                    <span className="ml-2 font-mono text-[10px] text-faint">
                      {t.w}-{t.l}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-xs">
                    {signed((t.off ?? 0) + (t.dfn ?? 0), 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <p className="mt-6 font-mono text-[10px] text-faint">
        Results: NCAA scoreboard. Lines: ESPN (ESPN BET, then DraftKings). Updated{" "}
        {new Date(data.updated).toLocaleString()}.
      </p>
    </>
  );
}
