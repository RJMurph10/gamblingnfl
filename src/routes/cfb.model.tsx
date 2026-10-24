import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MatchupLink, PageTitle, Panel, PanelHeader, StatCard, TeamLogo } from "@/components/booth";
import { CFB_HISTORY } from "@/data/cfb-best-bets-history";
import { gameScore } from "@/data/games";
import { teamById } from "@/data/teams";
import {
  CFB_RULES,
  addRecords,
  cfbBestBets,
  cfbRecord,
  recordFromCounts,
  recordText,
  type CfbPick,
  type CfbRecord,
  type CfbRuleId,
} from "@/lib/cfb-model";
import { unitsText } from "@/lib/game-model";
import { CfbWatchList } from "@/components/CfbWatchList";
import { currentCfbWeek, useCfbSchedule } from "@/lib/use-cfb";

export const Route = createFileRoute("/cfb/model")({
  head: () => ({
    meta: [
      { title: "Model — GamblingCFB" },
      {
        name: "description",
        content:
          "GamblingCFB's ★ best bets: college football rules tested on past seasons against closing lines, this week's picks and the record in units.",
      },
    ],
  }),
  component: CfbModel,
});

const SEASON = 2026;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const lineText = (n: number) => (n === 0 ? "PK" : n > 0 ? `+${n}` : String(n));
const toneOf = (u: number): "win" | "loss" | "mute" => (u > 0 ? "win" : u < 0 ? "loss" : "mute");
const toneClass = (u: number) => (u > 0 ? "text-win" : u < 0 ? "text-loss" : "text-mute");
const RULE_TITLE = Object.fromEntries(CFB_RULES.map((r) => [r.id, r.title])) as Record<
  CfbRuleId,
  string
>;

function RecordCell({ r, bold = false }: { r?: CfbRecord; bold?: boolean }) {
  if (!r || r.wins + r.losses + r.pushes === 0)
    return <td className="px-3 py-2 text-right font-mono text-mute">—</td>;
  return (
    <td className={`px-3 py-2 text-right font-mono tabular-nums ${bold ? "font-semibold" : ""}`}>
      <span>{recordText(r)}</span>
      <span className="ml-2 text-mute">{r.winPct === null ? "—" : `${one(r.winPct)}%`}</span>
      <span className={`ml-2 ${toneClass(r.units)}`}>{unitsText(r.units)}</span>
    </td>
  );
}

function PickText({ pick }: { pick: CfbPick }) {
  if (pick.market === "total") return <span>Under {pick.line}</span>;
  const team = teamById(pick.side === "home" ? pick.game.homeTeamId : pick.game.awayTeamId);
  return (
    <span className="inline-flex items-center gap-1.5">
      {team ? <TeamLogo team={team} className="size-4" /> : null}
      <span>
        {team?.abbr} {lineText(pick.line)}
      </span>
    </span>
  );
}

function PickRow({ pick }: { pick: CfbPick }) {
  const g = pick.game;
  const away = teamById(g.awayTeamId);
  const home = teamById(g.homeTeamId);
  if (!away || !home) return null;
  const s = gameScore(g);
  const lost = pick.lastLoss ? Math.abs(pick.lastLoss.margin) : null;
  const trip = pick.miles ? `${away.abbr} traveled ${pick.miles.toLocaleString()} mi` : null;
  return (
    <tr className="border-b border-line/5 last:border-0 hover:bg-line/5">
      <td className="px-4 py-2.5 font-mono text-mute">Wk {g.week}</td>
      <td className="px-2 py-2.5 text-center">
        <MatchupLink
          game={g}
          away={away}
          home={home}
          awayScore={g.status !== "scheduled" ? s.away : ""}
          homeScore={g.status !== "scheduled" ? s.home : ""}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 font-mono font-semibold">
        <span className="mr-1 text-acc">★</span>
        <PickText pick={pick} />
      </td>
      <td className="px-2 py-2.5 text-[12px] text-mute">
        {RULE_TITLE[pick.rule]}
        {lost ? ` · lost by ${lost} last game` : ""}
        {trip ? ` · ${trip}` : ""}
      </td>
      <td
        className={`px-4 py-2.5 text-right font-mono text-[11px] uppercase ${
          pick.result === "win"
            ? "text-win"
            : pick.result === "loss"
              ? "text-loss"
              : pick.result === "push"
                ? "text-mute"
                : "text-acc"
        }`}
      >
        {pick.result === "pending" ? (g.status === "live" ? "live" : "upcoming") : pick.result}
      </td>
    </tr>
  );
}

function PickTable({ picks, empty }: { picks: CfbPick[]; empty: string }) {
  if (!picks.length)
    return <p className="px-4 py-6 text-center font-mono text-xs text-mute">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Week</th>
            <th className="px-2 py-2 text-center font-normal">Matchup</th>
            <th className="px-2 py-2 font-normal">Pick</th>
            <th className="px-2 py-2 font-normal">Why</th>
            <th className="px-4 py-2 text-right font-normal">Result</th>
          </tr>
        </thead>
        <tbody>
          {picks.map((p) => (
            <PickRow key={`${p.rule}-${p.game.id}`} pick={p} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CfbModel() {
  const { games, isLoading } = useCfbSchedule(60_000);
  const picks = useMemo(() => cfbBestBets(games), [games]);
  const graded = picks.filter((p) => p.result !== "pending");
  const week = currentCfbWeek(games);
  const upcoming = picks.filter((p) => p.result === "pending" && p.game.week === week);
  const season = cfbRecord(graded);
  const byRule = (rule: CfbRuleId) => cfbRecord(graded.filter((p) => p.rule === rule));

  // Past seasons (fixed) plus this season (live).
  const seasons = useMemo(() => {
    const past = Object.entries(CFB_HISTORY)
      .map(([year, rules]) => {
        const r = Object.fromEntries(
          CFB_RULES.map((rule) => [rule.id, recordFromCounts(rules[rule.id] ?? [0, 0, 0])]),
        ) as Record<CfbRuleId, CfbRecord>;
        return { label: year, rules: r, all: addRecords(Object.values(r)) };
      })
      .sort((a, b) => Number(b.label) - Number(a.label));
    return past;
  }, []);
  const allTime = addRecords(seasons.map((s) => s.all));
  const winningSeasons = seasons.filter((s) => s.all.units > 0).length;

  return (
    <>
      <PageTitle eyebrow="FBS · flat 1 unit per pick at -110" title="Model" />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label={`★ Best bets · ${SEASON}`}
            value={isLoading ? "…" : recordText(season)}
            note={
              isLoading
                ? "Loading…"
                : `${season.winPct === null ? "—" : `${one(season.winPct)}% won`} · ${unitsText(season.units)}`
            }
            tone={toneOf(season.units)}
          />
          {CFB_RULES.map((rule) => {
            const r = byRule(rule.id);
            return (
              <StatCard
                key={rule.id}
                label={rule.title}
                value={isLoading ? "…" : recordText(r)}
                note={`${r.winPct === null ? "—" : `${one(r.winPct)}%`} · ${unitsText(r.units)}`}
                tone={toneOf(r.units)}
              />
            );
          })}
          <StatCard
            label="Since 2009"
            value={unitsText(allTime.units)}
            note={`${recordText(allTime)} · ${one(allTime.winPct ?? 0)}% · ${winningSeasons}/${seasons.length} winning seasons`}
            tone={toneOf(allTime.units)}
          />
        </div>

        <Panel padded={false}>
          <PanelHeader
            title={week ? `Week ${week} picks` : "Upcoming picks"}
            aside={
              <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                Lines update until kickoff
              </span>
            }
          />
          <PickTable
            picks={upcoming}
            empty={
              isLoading ? "Loading the schedule and lines…" : "No ★ best bets this week (yet)."
            }
          />
        </Panel>

        <Panel>
          <h2 className="font-disp text-lg font-semibold uppercase tracking-tight">
            The ★ best bet rules
          </h2>
          <p className="mt-1 text-sm text-mute">
            Each rule was looked for on 2009–2017 and then checked on 2018–2025, seasons it never
            saw, against the consensus closing line. Early-season unders were flat on the older
            seasons and only took off in 2018, so they&apos;re the least proven of the four. Dozens
            of other angles were tested and dropped because they didn&apos;t hold up on the newer
            seasons (big underdogs, home dogs, byes, Thursday and #MACtion unders,
            conference-specific unders, Elo ratings vs the line, altitude, domes, cold northern
            November games).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CFB_RULES.map((rule) => (
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
                </dl>
              </div>
            ))}
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHeader
            title="Track record by season"
            aside={
              <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                Closing lines · FBS vs FBS
              </span>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line/10 text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="px-3 py-2 font-normal">Season</th>
                  {CFB_RULES.map((r) => (
                    <th key={r.id} className="px-3 py-2 text-right font-normal">
                      {r.title}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-normal">★ Best bets</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/10 bg-acc/5">
                  <td className="px-3 py-2 font-mono">{SEASON} so far</td>
                  {CFB_RULES.map((r) => (
                    <RecordCell key={r.id} r={byRule(r.id)} />
                  ))}
                  <RecordCell r={season} bold />
                </tr>
                {seasons.map((s) => (
                  <tr key={s.label} className="border-b border-line/10 last:border-0">
                    <td className="px-3 py-2 font-mono">{s.label}</td>
                    {CFB_RULES.map((r) => (
                      <RecordCell key={r.id} r={s.rules[r.id]} />
                    ))}
                    <RecordCell r={s.all} bold />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 pt-2 text-[11px] text-faint">
            Past seasons use the consensus closing line across sportsbooks; {SEASON} uses the line
            ESPN shows at kickoff. Units: +0.91 per win, −1 per loss, pushes 0. Games against FCS
            teams and bowls aren&apos;t included.
          </p>
        </Panel>

        <CfbWatchList games={games} season={SEASON} />

        <Panel padded={false}>
          <PanelHeader
            title={`Graded picks · ${SEASON}`}
            aside={
              <span className="font-mono text-[10px] uppercase tracking-wider text-mute">
                Newest first
              </span>
            }
          />
          <PickTable
            picks={[...graded].reverse()}
            empty={isLoading ? "Loading…" : "No graded picks yet this season."}
          />
        </Panel>

        <p className="font-mono text-[10px] uppercase tracking-wider text-faint">
          For research, not betting advice ·{" "}
          <Link to="/cfb/games" className="text-acc">
            This week&apos;s games →
          </Link>
        </p>
      </div>
    </>
  );
}
