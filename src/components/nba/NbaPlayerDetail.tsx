/** One NBA player: bio, season averages, a last-games chart and the game log. */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageTitle, Panel, PanelHeader, StatCard } from "@/components/shared/booth";
import { NbaLogo } from "@/components/nba/NbaBits";
import {
  STAT_SHORT,
  averageLog,
  nbaHeadshot,
  pct,
  statValue,
  type NbaLogRow,
  type NbaStatKey,
} from "@/lib/nba/nba";
import { useNbaPlayerProfile, useNbaTeams } from "@/lib/nba/use-nba";

const CHART_STATS: NbaStatKey[] = ["pts", "reb", "ast", "fg3m", "pra"];

export function NbaPlayerDetail({ playerId }: { playerId: string }) {
  const q = useNbaPlayerProfile(playerId);
  const { teams } = useNbaTeams();
  const [season, setSeason] = useState<"current" | "prior">("current");
  const profile = q.data;
  const player = profile?.player ?? null;
  const team = teams.find((t) => t.id === player?.teamId);

  const currentRows = useMemo(() => (profile?.current ?? []).filter((r) => r.part !== "pre"), [profile]);
  const priorRows = useMemo(() => (profile?.prior ?? []).filter((r) => r.part !== "pre"), [profile]);
  // Early in the season the new year has few games: default to last season's log if none yet.
  const active: "current" | "prior" = season === "current" && !currentRows.length && priorRows.length ? "prior" : season;
  const rows = active === "current" ? currentRows : priorRows;
  const avg = useMemo(() => averageLog(rows), [rows]);
  const seasonLabel = (y: number) => `${y - 1}-${String(y).slice(2)}`;

  if (!player && !q.isLoading)
    return (
      <>
        <PageTitle eyebrow="NBA" title="Player not found" />
        <Panel>
          <p className="py-6 text-center font-mono text-xs text-mute">
            ESPN has no player with this id.{" "}
            <Link to="/nba/players" className="text-acc">All players →</Link>
          </p>
        </Panel>
      </>
    );
  if (!player) return <PageTitle eyebrow="NBA" title="Loading player…" />;

  const bio = [player.position, player.height, player.weight, player.age ? `${player.age} yrs` : "", player.experience === 0 ? "Rookie" : player.experience ? `${player.experience} yrs exp` : "", player.college].filter(Boolean);

  return (
    <>
      <PageTitle eyebrow={`${team?.name ?? player.teamAbbr}${player.jersey ? ` · #${player.jersey}` : ""}`} title={player.name} />
      <Panel className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <img src={player.headshot || nbaHeadshot(player.id)} alt={player.name} className="size-24 rounded-2xl bg-panel2 object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
          <div className="min-w-0 flex-1">
            {team ? (
              <Link to="/nba/teams/$teamId" params={{ teamId: team.id }} className="inline-flex items-center gap-2 hover:text-acc">
                <NbaLogo team={team} className="size-7" />
                <span className="font-disp text-xl font-semibold uppercase tracking-tight">{team.name}</span>
              </Link>
            ) : null}
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-faint">{bio.join(" · ")}</p>
            {player.status ? <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-loss">{player.status}</p> : null}
          </div>
        </div>
      </Panel>

      <div className="mb-3 flex gap-2">
        {(["current", "prior"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeason(s)}
            aria-pressed={active === s}
            className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wider ring-1 ${active === s ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
          >
            {seasonLabel(s === "current" ? profile!.season : profile!.season - 1)}
          </button>
        ))}
      </div>

      {!rows.length ? (
        <Panel>
          <p className="py-6 text-center font-mono text-xs text-mute">{q.isLoading ? "Loading game log…" : "No games played in this season."}</p>
        </Panel>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label="Games" value={String(avg.gp)} />
            <StatCard label="Minutes" value={avg.min.toFixed(1)} />
            <StatCard label="Points" value={avg.pts.toFixed(1)} note={`FG ${pct(avg.fgPct)}`} />
            <StatCard label="Rebounds" value={avg.reb.toFixed(1)} />
            <StatCard label="Assists" value={avg.ast.toFixed(1)} note={`TOV ${avg.tov.toFixed(1)}`} />
            <StatCard label="3PM" value={avg.fg3m.toFixed(1)} note={`3P ${pct(avg.fg3Pct)} · FT ${pct(avg.ftPct)}`} />
          </div>
          <TrendChart rows={rows} />
          <GameLog rows={rows} />
        </>
      )}
    </>
  );
}

/** Bars for the last 15 games of one stat, with the season average as a line. */
function TrendChart({ rows }: { rows: NbaLogRow[] }) {
  const [stat, setStat] = useState<NbaStatKey>("pts");
  const recent = rows.slice(0, 15).reverse();
  const values = recent.map((r) => statValue(r, stat));
  const max = Math.max(...values, 1);
  const mean = rows.length ? rows.reduce((s, r) => s + statValue(r, stat), 0) / rows.length : 0;
  return (
    <Panel padded={false} className="mb-6">
      <PanelHeader
        title="Last 15 games"
        aside={
          <div className="flex flex-wrap gap-1.5">
            {CHART_STATS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStat(s)}
                aria-pressed={stat === s}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ${stat === s ? "bg-acc/10 text-acc ring-acc/25" : "bg-panel2 text-mute ring-line/10 hover:text-acc"}`}
              >
                {STAT_SHORT[s]}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex h-44 items-end gap-1.5 px-4 pb-4 pt-6">
        {recent.map((r, i) => (
          <div key={r.gameId + i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${new Date(r.date).toLocaleDateString()} ${r.home ? "vs" : "@"} ${r.opp}: ${values[i]}`}>
            <span className="font-mono text-[10px] tabular-nums text-mute">{values[i]}</span>
            <div className={`w-full rounded-t ${values[i] >= mean ? "bg-win/70" : "bg-loss/60"}`} style={{ height: `${Math.max(4, (values[i] / max) * 100)}px`, maxHeight: "100px" }} />
            <span className="font-mono text-[9px] text-faint">{r.opp}</span>
          </div>
        ))}
      </div>
      <p className="px-4 pb-3 font-mono text-[10px] uppercase tracking-wider text-faint">Season average {mean.toFixed(1)} · green above, red below</p>
    </Panel>
  );
}

function GameLog({ rows }: { rows: NbaLogRow[] }) {
  const [limit, setLimit] = useState(20);
  return (
    <Panel padded={false}>
      <PanelHeader title="Game log" aside={<span className="label-mono">{rows.length} games</span>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2 font-normal">Date</th>
              <th className="px-2 py-2 font-normal">Opp</th>
              <th className="px-2 py-2 font-normal">Result</th>
              {["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "FG", "3PT", "FT"].map((h) => (
                <th key={h} className="px-2 py-2 text-right font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/5">
            {rows.slice(0, limit).map((r, i) => (
              <tr key={r.gameId + i} className="hover:bg-line/5">
                <td className="px-4 py-2 font-mono text-[11px] text-mute" suppressHydrationWarning>{new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric" })}{r.part === "post" ? " ·P" : ""}</td>
                <td className="px-2 py-2">
                  <Link to="/nba/games/$gameId" params={{ gameId: r.gameId }} className="font-mono text-[12px] hover:text-acc">{r.home ? "vs" : "@"} {r.opp}</Link>
                </td>
                <td className={`px-2 py-2 font-mono text-[11px] ${r.result === "W" ? "text-win" : r.result === "L" ? "text-loss" : "text-mute"}`}>{r.result} {r.score}</td>
                {[r.min, r.pts, r.reb, r.ast, r.stl, r.blk, r.tov].map((v, j) => (
                  <td key={j} className="px-2 py-2 text-right font-mono text-[12px] tabular-nums">{v}</td>
                ))}
                <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums">{r.fgm}-{r.fga}</td>
                <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums">{r.fg3m}-{r.fg3a}</td>
                <td className="px-2 py-2 text-right font-mono text-[12px] tabular-nums">{r.ftm}-{r.fta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button onClick={() => setLimit((l) => l + 30)} className="w-full px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-acc hover:bg-line/5">
          Show more ({rows.length - limit} remaining)
        </button>
      ) : null}
    </Panel>
  );
}
