/** An NBA team's page: season metrics with league ranks, then schedule / roster / player stats tabs. */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel } from "@/components/booth";
import { NbaLogo, statusText } from "@/components/nba/NbaBits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  atsResult,
  divisionOf,
  hasScore,
  nbaHeadshot,
  ouResult,
  spreadText,
  winnerOf,
  type NbaGame,
  type NbaPlayer,
  type NbaStandingRow,
  type NbaTeamRef,
} from "@/lib/nba";
import { buildRatings, ratingRows } from "@/lib/nba-model";
import { useNbaPlayerIndex, useNbaPrior, useNbaRoster, useNbaSchedule, useNbaStandings } from "@/lib/use-nba";

const tabClass =
  "rounded-none border-b-2 border-transparent px-5 py-3 data-[state=active]:border-acc data-[state=active]:bg-transparent";

function rankOf(rows: NbaStandingRow[], teamId: string, get: (r: NbaStandingRow) => number, higherIsBetter = true) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => (higherIsBetter ? get(b) - get(a) : get(a) - get(b)));
  const i = sorted.findIndex((r) => r.teamId === teamId);
  return i < 0 ? null : i + 1;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function Metric({ label, value, sub, rank, of }: { label: string; value: string; sub?: string; rank?: number | null; of?: number }) {
  return (
    <Panel>
      <p className="label-mono">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-mute">{[rank ? `${ordinal(rank)}${of ? ` of ${of}` : ""}` : "", sub].filter(Boolean).join(" · ")}</p>
    </Panel>
  );
}

export function NbaTeamDetail({ team }: { team: NbaTeamRef }) {
  const { games, isLoading } = useNbaSchedule(5 * 60_000);
  const standings = useNbaStandings();
  const prior = useNbaPrior();
  const row = standings.rows.find((r) => r.teamId === team.id);
  const division = divisionOf(team.abbr);

  const teamGames = useMemo(
    () => games.filter((g) => g.home.team.id === team.id || g.away.team.id === team.id).sort((a, b) => a.date.localeCompare(b.date)),
    [games, team.id],
  );

  const rating = useMemo(() => {
    const finals = games.filter((g) => g.status === "final" && g.part !== "pre" && hasScore(g));
    const rows = ratingRows(buildRatings(finals, prior));
    return { rows, mine: rows.find((r) => r.teamId === team.id) };
  }, [games, prior, team.id]);

  // Against the spread and totals, from finished games that have lines.
  const ledger = useMemo(() => {
    let w = 0, l = 0, p = 0, over = 0, under = 0;
    for (const g of teamGames) {
      if (g.part === "pre") continue;
      const ats = atsResult(g);
      if (ats) {
        const mine = g.home.team.id === team.id ? "home" : "away";
        if (ats === "push") p++;
        else if (ats === mine) w++;
        else l++;
      }
      const ou = ouResult(g);
      if (ou === "over") over++;
      else if (ou === "under") under++;
    }
    return { w, l, p, over, under };
  }, [teamGames, team.id]);

  const all = standings.rows;
  return (
    <>
      <PageTitle eyebrow={[division ? `${division.conference}ern Conference` : "", division?.name].filter(Boolean).join(" · ") || "NBA"} title={team.name} />
      <Panel className="mb-6" >
        <div className="flex flex-wrap items-center gap-4">
          <NbaLogo team={team} className="size-20" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-3xl tabular-nums">
              {row ? `${row.wins}-${row.losses}` : "—"}
              {row?.seed ? <span className="ml-3 text-sm text-mute">#{row.seed} seed</span> : null}
            </p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-faint">
              {[row?.streak && `Streak ${row.streak}`, row?.lastTen && `L10 ${row.lastTen}`, row?.home && `Home ${row.home}`, row?.road && `Road ${row.road}`].filter(Boolean).join(" · ") || (standings.isLoading ? "Loading record…" : "")}
            </p>
          </div>
          <div className="h-1.5 w-full rounded-full sm:w-48" style={{ background: team.color }} />
        </div>
      </Panel>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Points / game"
          value={row?.ppg ? row.ppg.toFixed(1) : "—"}
          rank={row?.ppg ? rankOf(all, team.id, (r) => r.ppg) : null}
          of={all.length}
        />
        <Metric
          label="Opp. points / game"
          value={row?.oppPpg ? row.oppPpg.toFixed(1) : "—"}
          rank={row?.oppPpg ? rankOf(all, team.id, (r) => r.oppPpg, false) : null}
          of={all.length}
          sub="fewer is better"
        />
        <Metric
          label="Scoring margin"
          value={row?.ppg ? `${row.diff > 0 ? "+" : ""}${row.diff.toFixed(1)}` : "—"}
          rank={row?.ppg ? rankOf(all, team.id, (r) => r.diff) : null}
          of={all.length}
        />
        <Metric
          label="Model net rating"
          value={rating.mine ? `${rating.mine.net > 0 ? "+" : ""}${rating.mine.net.toFixed(1)}` : "—"}
          rank={rating.mine?.rank}
          of={rating.rows.length}
          sub={rating.mine ? `off ${rating.mine.offense.toFixed(1)} · def ${rating.mine.defense.toFixed(1)}` : undefined}
        />
        <Metric label="Against the spread" value={`${ledger.w}-${ledger.l}${ledger.p ? `-${ledger.p}` : ""}`} sub="this season" />
        <Metric label="Totals" value={`${ledger.over}O-${ledger.under}U`} sub="this season" />
        <Metric label="Conference record" value={row?.conferenceRecord || "—"} />
        <Metric label="Games behind" value={row?.gamesBehind || "—"} />
      </div>

      <Panel padded={false}>
        <Tabs defaultValue="schedule">
          <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b border-line/10 bg-transparent p-0">
            <TabsTrigger value="schedule" className={tabClass}>Schedule</TabsTrigger>
            <TabsTrigger value="stats" className={tabClass}>Player stats</TabsTrigger>
            <TabsTrigger value="roster" className={tabClass}>Roster</TabsTrigger>
          </TabsList>
          <TabsContent value="schedule" className="m-0">
            <Schedule team={team} games={teamGames} loading={isLoading} />
          </TabsContent>
          <TabsContent value="stats" className="m-0">
            <PlayerStats team={team} />
          </TabsContent>
          <TabsContent value="roster" className="m-0">
            <Roster team={team} />
          </TabsContent>
        </Tabs>
      </Panel>
    </>
  );
}

function Schedule({ team, games, loading }: { team: NbaTeamRef; games: NbaGame[]; loading: boolean }) {
  if (!games.length) return <p className="px-4 py-8 text-center font-mono text-xs text-mute">{loading ? "Loading schedule…" : "No games on ESPN's schedule yet."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Date</th>
            <th className="px-2 py-2 font-normal">Opponent</th>
            <th className="px-2 py-2 font-normal">Result</th>
            <th className="px-2 py-2 font-normal">Line</th>
            <th className="px-4 py-2 text-right font-normal">ATS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {games.map((g) => {
            const home = g.home.team.id === team.id;
            const opp = home ? g.away.team : g.home.team;
            const w = winnerOf(g);
            const won = w ? (w === "home") === home : null;
            const ats = atsResult(g);
            const mine = home ? "home" : "away";
            return (
              <tr key={g.id} className="hover:bg-line/5">
                <td className="px-4 py-2.5 font-mono text-[11px] text-mute" suppressHydrationWarning>
                  {new Date(g.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                  {g.part === "pre" ? <span className="ml-1 text-faint">pre</span> : null}
                </td>
                <td className="px-2 py-2.5">
                  <Link to="/nba/games/$gameId" params={{ gameId: g.id }} className="inline-flex items-center gap-2 hover:text-acc">
                    <span className="font-mono text-[10px] text-faint">{home ? "vs" : "@"}</span>
                    <NbaLogo team={opp} className="size-5" />
                    {opp.name}
                  </Link>
                </td>
                <td className="px-2 py-2.5 font-mono text-[12px]">
                  {g.status === "final" && hasScore(g) ? (
                    <span className={won ? "text-win" : "text-loss"}>
                      {won ? "W" : "L"} {home ? `${g.home.score}-${g.away.score}` : `${g.away.score}-${g.home.score}`}
                    </span>
                  ) : (
                    <span className={g.status === "live" ? "text-win" : "text-mute"} suppressHydrationWarning>{statusText(g)}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 font-mono text-[11px] text-mute">
                  {g.odds?.spread != null ? spreadText(g, g.odds.spread) : "—"}
                  {g.odds?.total ? ` · ${g.odds.total}` : ""}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono text-[11px] uppercase ${ats === "push" ? "text-mute" : ats ? (ats === mine ? "text-win" : "text-loss") : "text-faint"}`}>
                  {ats ? (ats === "push" ? "push" : ats === mine ? "cover" : "miss") : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Roster({ team }: { team: NbaTeamRef }) {
  const q = useNbaRoster(team.id);
  const players = (q.data as NbaPlayer[] | undefined) ?? [];
  if (!players.length) return <p className="px-4 py-8 text-center font-mono text-xs text-mute">{q.isLoading ? "Loading roster…" : "ESPN has no roster for this team."}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">#</th>
            <th className="px-2 py-2 font-normal">Player</th>
            <th className="px-2 py-2 font-normal">Pos</th>
            <th className="px-2 py-2 font-normal">Ht</th>
            <th className="px-2 py-2 font-normal">Wt</th>
            <th className="px-2 py-2 font-normal">Age</th>
            <th className="px-2 py-2 font-normal">Exp</th>
            <th className="px-4 py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {players.map((p) => (
            <tr key={p.id} className="hover:bg-line/5">
              <td className="px-4 py-2.5 font-mono text-[11px] text-faint">{p.jersey ?? ""}</td>
              <td className="px-2 py-2.5">
                <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="inline-flex items-center gap-2 font-medium hover:text-acc">
                  <img src={p.headshot || nbaHeadshot(p.id)} alt="" loading="lazy" className="size-7 rounded-full bg-panel2 object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  {p.name}
                </Link>
              </td>
              <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.position}</td>
              <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.height ?? ""}</td>
              <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.weight ?? ""}</td>
              <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.age ?? ""}</td>
              <td className="px-2 py-2.5 font-mono text-[11px] text-mute">{p.experience === 0 ? "R" : (p.experience ?? "")}</td>
              <td className={`px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider ${p.status ? "text-loss" : "text-faint"}`}>{p.status ?? "Active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerStats({ team }: { team: NbaTeamRef }) {
  const q = useNbaPlayerIndex();
  const players = useMemo(
    () =>
      (q.data?.players ?? [])
        .filter((p) => p.teamId === team.id && p.avg)
        .sort((a, b) => (b.avg?.pts ?? 0) - (a.avg?.pts ?? 0)),
    [q.data, team.id],
  );
  if (!players.length) return <p className="px-4 py-8 text-center font-mono text-xs text-mute">{q.isLoading ? "Loading player stats…" : "No player stats are available yet."}</p>;
  const cols: [string, (p: NbaPlayer) => string][] = [
    ["GP", (p) => String(p.avg!.gp)],
    ["MIN", (p) => p.avg!.min.toFixed(1)],
    ["PTS", (p) => p.avg!.pts.toFixed(1)],
    ["REB", (p) => p.avg!.reb.toFixed(1)],
    ["AST", (p) => p.avg!.ast.toFixed(1)],
    ["STL", (p) => p.avg!.stl.toFixed(1)],
    ["BLK", (p) => p.avg!.blk.toFixed(1)],
    ["FG%", (p) => (p.avg!.fgPct === null ? "—" : (p.avg!.fgPct * 100).toFixed(1))],
    ["3P%", (p) => (p.avg!.fg3Pct === null ? "—" : (p.avg!.fg3Pct * 100).toFixed(1))],
  ];
  return (
    <div className="overflow-x-auto">
      <p className="px-4 pt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
        Per-game averages · {q.data!.statsSeason - 1}-{String(q.data!.statsSeason).slice(2)} season
      </p>
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
            <th className="px-4 py-2 font-normal">Player</th>
            {cols.map(([l]) => (
              <th key={l} className="px-2 py-2 text-right font-normal">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/5">
          {players.map((p) => (
            <tr key={p.id} className="hover:bg-line/5">
              <td className="px-4 py-2.5">
                <Link to="/nba/players/$playerId" params={{ playerId: p.id }} className="font-medium hover:text-acc">{p.name}</Link>
                <span className="ml-2 font-mono text-[10px] text-faint">{p.position}</span>
              </td>
              {cols.map(([l, f]) => (
                <td key={l} className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums">{f(p)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

