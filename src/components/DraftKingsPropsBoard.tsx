import { useState, useMemo } from "react";
import { type Game } from "@/data/games";
import { type Team } from "@/data/teams";
import { TeamLogo } from "@/components/booth";
import {
  type PropCategory,
  type TDMarket,
  type PassingMetric,
  type RushingMetric,
  type ReceivingMetric,
  type PlayerPropLine,
  type TDScorerLine,
} from "@/lib/props.types";

interface DraftKingsPropsBoardProps {
  game: Game;
  away: Team;
  home: Team;
}

export function DraftKingsPropsBoard({ game, away, home }: DraftKingsPropsBoardProps) {
  const [category, setCategory] = useState<PropCategory>("td-scorers");
  const [teamFilter, setTeamFilter] = useState<"all" | "away" | "home">("all");
  const [tdMarket, setTdMarket] = useState<TDMarket>("all");
  const [passingMetric, setPassingMetric] = useState<PassingMetric>("yards");
  const [rushingMetric, setRushingMetric] = useState<RushingMetric>("yards");
  const [receivingMetric, setReceivingMetric] = useState<ReceivingMetric>("yards");

  const isLive = game.status === "live" || game.status === "halftime";
  const isFinal = game.status === "final";
  const isOT = (game.period ?? 0) > 4;

  // Extract recorded box-score stats from the game if available (live or final)
  const playerStatsMap = useMemo(() => {
    const map = new Map<string, { passYds: number; rushYds: number; recYds: number; tds: number }>();
    const statsList = game.playerStats || [];
    for (const p of statsList) {
      map.set(p.name.toLowerCase(), {
        passYds: p.passYds ?? 0,
        rushYds: p.rushYds ?? 0,
        recYds: p.recYds ?? 0,
        tds: p.touchdowns ?? 0,
      });
    }
    return map;
  }, [game.playerStats]);

  // Generate dynamic player rows based on team rosters or recorded game players
  const tdScorerRows: TDScorerLine[] = useMemo(() => {
    const list: TDScorerLine[] = [];
    const offensivePlayers = (game.playerStats || []).filter(
      (p) => ["QB", "RB", "WR", "TE", "FB"].includes(p.position) || (p.rushYds || 0) > 0 || (p.recYds || 0) > 0
    );

    // If no stats yet (scheduled), generate standard key offensive starters
    const source = offensivePlayers.length > 0 ? offensivePlayers : [
      { name: "Starting RB", team: away.abbr, position: "RB" },
      { name: "Starting WR1", team: away.abbr, position: "WR" },
      { name: "Starting QB", team: away.abbr, position: "QB" },
      { name: "Starting RB", team: home.abbr, position: "RB" },
      { name: "Starting WR1", team: home.abbr, position: "WR" },
      { name: "Starting QB", team: home.abbr, position: "QB" },
    ];

    for (const p of source) {
      const stats = playerStatsMap.get(p.name.toLowerCase());
      const tds = stats?.tds ?? 0;
      list.push({
        playerId: p.name,
        playerName: p.name,
        teamAbbr: p.team || away.abbr,
        position: p.position || "OFF",
        firstOdds: "+450",
        anytimeOdds: p.position === "RB" ? "+110" : p.position === "WR" ? "+145" : "+350",
        multiOdds: "+650",
        scoredTD: tds > 0,
        tdCount: tds,
      });
    }

    return list.filter((r) => {
      if (teamFilter === "away") return r.teamAbbr === away.abbr;
      if (teamFilter === "home") return r.teamAbbr === home.abbr;
      return true;
    });
  }, [game.playerStats, playerStatsMap, teamFilter, away.abbr, home.abbr]);

  // Dynamic Passing lines
  const passingRows: PlayerPropLine[] = useMemo(() => {
    const qbs = (game.playerStats || []).filter((p) => p.position === "QB");
    const source = qbs.length > 0 ? qbs : [
      { name: `${away.name} QB`, team: away.abbr, position: "QB" },
      { name: `${home.name} QB`, team: home.abbr, position: "QB" },
    ];

    return source
      .map((p) => {
        const stats = playerStatsMap.get(p.name.toLowerCase());
        const current = stats?.passYds ?? 0;
        const line = 238.5;
        let result: "over" | "under" | "pending" = "pending";
        if (isFinal) {
          result = current > line ? "over" : "under";
        }

        return {
          playerId: p.name,
          playerName: p.name,
          teamAbbr: p.team || away.abbr,
          position: "QB",
          metric: "Passing Yards",
          line,
          overOdds: "-115",
          underOdds: "-115",
          currentStat: isLive || isFinal ? current : undefined,
          result,
        };
      })
      .filter((r) => (teamFilter === "away" ? r.teamAbbr === away.abbr : teamFilter === "home" ? r.teamAbbr === home.abbr : true));
  }, [game.playerStats, playerStatsMap, teamFilter, away, home, isLive, isFinal]);

  // Dynamic Rushing lines
  const rushingRows: PlayerPropLine[] = useMemo(() => {
    const rbs = (game.playerStats || []).filter((p) => ["RB", "FB"].includes(p.position) || (p.rushYds || 0) > 0);
    const source = rbs.length > 0 ? rbs : [
      { name: `${away.name} RB1`, team: away.abbr, position: "RB" },
      { name: `${home.name} RB1`, team: home.abbr, position: "RB" },
    ];

    return source
      .map((p) => {
        const stats = playerStatsMap.get(p.name.toLowerCase());
        const current = stats?.rushYds ?? 0;
        const line = 64.5;
        let result: "over" | "under" | "pending" = "pending";
        if (isFinal) result = current > line ? "over" : "under";

        return {
          playerId: p.name,
          playerName: p.name,
          teamAbbr: p.team || away.abbr,
          position: p.position || "RB",
          metric: "Rushing Yards",
          line,
          overOdds: "-110",
          underOdds: "-120",
          currentStat: isLive || isFinal ? current : undefined,
          result,
        };
      })
      .filter((r) => (teamFilter === "away" ? r.teamAbbr === away.abbr : teamFilter === "home" ? r.teamAbbr === home.abbr : true));
  }, [game.playerStats, playerStatsMap, teamFilter, away, home, isLive, isFinal]);

  // Dynamic Receiving lines
  const receivingRows: PlayerPropLine[] = useMemo(() => {
    const wrs = (game.playerStats || []).filter((p) => ["WR", "TE"].includes(p.position) || (p.recYds || 0) > 0);
    const source = wrs.length > 0 ? wrs : [
      { name: `${away.name} WR1`, team: away.abbr, position: "WR" },
      { name: `${home.name} WR1`, team: home.abbr, position: "WR" },
    ];

    return source
      .map((p) => {
        const stats = playerStatsMap.get(p.name.toLowerCase());
        const current = stats?.recYds ?? 0;
        const line = 54.5;
        let result: "over" | "under" | "pending" = "pending";
        if (isFinal) result = current > line ? "over" : "under";

        return {
          playerId: p.name,
          playerName: p.name,
          teamAbbr: p.team || away.abbr,
          position: p.position || "WR",
          metric: "Receiving Yards",
          line,
          overOdds: "-115",
          underOdds: "-115",
          currentStat: isLive || isFinal ? current : undefined,
          result,
        };
      })
      .filter((r) => (teamFilter === "away" ? r.teamAbbr === away.abbr : teamFilter === "home" ? r.teamAbbr === home.abbr : true));
  }, [game.playerStats, playerStatsMap, teamFilter, away, home, isLive, isFinal]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0d141c] overflow-hidden shadow-2xl">
      {/* DraftKings Sportsbook Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#121c27] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded bg-[#50b848] font-disp font-black text-black text-xs shadow-md">
            DK
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-disp text-sm font-bold uppercase tracking-wider text-white">
                DraftKings Sportsbook
              </span>
              <span className="rounded bg-[#50b848]/20 px-1.5 py-0.2 font-mono text-[10px] font-bold text-[#50b848] uppercase tracking-wider">
                Props
              </span>
            </div>
            <p className="text-[11px] text-mute">
              {isFinal
                ? "Official Game Results · Markets Closed"
                : isOT
                ? "Overtime In-Play · Live Props Active"
                : isLive
                ? `Live In-Play (${game.clock || "Q" + (game.period || "")})`
                : "Live Consensus Market Odds"}
            </p>
          </div>
        </div>

        {/* Live Quarter / Settlement Badge */}
        {isLive && (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-bold text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            {game.status === "halftime" ? "HALFTIME" : isOT ? "OVERTIME" : `Q${game.period} ${game.clock || ""}`}
          </div>
        )}
        {isFinal && (
          <div className="rounded-md border border-line/30 bg-surface/50 px-2.5 py-1 text-xs font-mono font-bold text-mute uppercase">
            Market Closed · Final
          </div>
        )}

        {/* Team filter pills */}
        <div className="flex items-center gap-1 rounded-lg bg-black/40 p-1 border border-white/10">
          {(["all", "away", "home"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setTeamFilter(filter)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                teamFilter === filter
                  ? "bg-[#1c2936] text-white shadow-sm border border-[#50b848]/40"
                  : "text-mute hover:text-foreground"
              }`}
            >
              {filter === "all" ? (
                "All"
              ) : filter === "away" ? (
                <>
                  <TeamLogo team={away} size="sm" />
                  <span>{away.abbr}</span>
                </>
              ) : (
                <>
                  <TeamLogo team={home} size="sm" />
                  <span>{home.abbr}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Category Pills: TD Scorers · Passing · Rushing · Receiving */}
      <div className="flex border-b border-white/10 bg-[#0f1722] p-1.5 gap-1.5 overflow-x-auto">
        {[
          ["td-scorers", "TD Scorers"],
          ["passing", "Passing"],
          ["rushing", "Rushing"],
          ["receiving", "Receiving"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key as PropCategory)}
            className={`whitespace-nowrap px-4 py-2 text-xs font-disp uppercase tracking-wider font-bold rounded-lg transition-all ${
              category === key
                ? "bg-[#50b848] text-black shadow-md shadow-[#50b848]/20"
                : "bg-surface/30 text-mute hover:bg-surface hover:text-foreground border border-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Category Content */}
      <div className="p-4">
        {category === "td-scorers" ? (
          <div>
            {/* TD Market Sub-Filter */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-1.5">
                {[
                  ["all", "All TD Markets"],
                  ["anytime", "Anytime TD"],
                  ["first", "First TD"],
                  ["multi", "2+ TDs"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTdMarket(key as TDMarket)}
                    className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all ${
                      tdMarket === key
                        ? "bg-[#1f2d3d] text-white border border-[#50b848]/50"
                        : "bg-surface/20 text-mute hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-mute font-mono">American Odds</span>
            </div>

            {/* TD Scorers Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-disp uppercase tracking-wider text-mute">
                    <th className="py-2 px-3">Player</th>
                    {(tdMarket === "all" || tdMarket === "first") && <th className="py-2 px-2 text-center">First TD</th>}
                    {(tdMarket === "all" || tdMarket === "anytime") && <th className="py-2 px-2 text-center">Anytime TD</th>}
                    {(tdMarket === "all" || tdMarket === "multi") && <th className="py-2 px-2 text-center">2+ TDs</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tdScorerRows.map((player) => (
                    <tr key={player.playerId} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          {player.playerName}
                          {player.scoredTD && (
                            <span className="rounded bg-[#50b848]/20 px-1.5 py-0.2 font-mono text-[9px] font-bold text-[#50b848]">
                              TD HIT ({player.tdCount})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-mute">
                          {player.position} · {player.teamAbbr}
                        </div>
                      </td>

                      {(tdMarket === "all" || tdMarket === "first") && (
                        <td className="py-2.5 px-2 text-center">
                          <button
                            disabled={isFinal}
                            className="w-20 rounded-md border border-white/10 bg-[#16222f] hover:border-[#50b848]/50 py-1.5 font-mono text-xs font-bold text-[#50b848] transition-all disabled:opacity-50"
                          >
                            {player.firstOdds}
                          </button>
                        </td>
                      )}

                      {(tdMarket === "all" || tdMarket === "anytime") && (
                        <td className="py-2.5 px-2 text-center">
                          <button
                            disabled={isFinal}
                            className={`w-20 rounded-md border py-1.5 font-mono text-xs font-bold transition-all disabled:opacity-60 ${
                              player.scoredTD
                                ? "border-[#50b848] bg-[#50b848]/20 text-[#50b848]"
                                : "border-white/10 bg-[#16222f] hover:border-[#50b848]/50 text-[#50b848]"
                            }`}
                          >
                            {player.scoredTD ? "HIT" : player.anytimeOdds}
                          </button>
                        </td>
                      )}

                      {(tdMarket === "all" || tdMarket === "multi") && (
                        <td className="py-2.5 px-2 text-center">
                          <button
                            disabled={isFinal}
                            className="w-20 rounded-md border border-white/10 bg-[#16222f] hover:border-[#50b848]/50 py-1.5 font-mono text-xs font-bold text-[#50b848] transition-all disabled:opacity-50"
                          >
                            {player.multiOdds}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Passing / Rushing / Receiving Over-Under Board */
          <div>
            <div className="mb-3 flex items-center justify-between text-[11px] text-mute">
              <span>{category.toUpperCase()} YARDAGE OVER / UNDER</span>
              <span className="font-mono">Odds: -115 standard</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(category === "passing" ? passingRows : category === "rushing" ? rushingRows : receivingRows).map(
                (row) => (
                  <div
                    key={row.playerId}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-[#121c27] p-3 hover:border-white/20 transition-all"
                  >
                    <div>
                      <div className="font-bold text-white text-sm">{row.playerName}</div>
                      <div className="text-[11px] text-mute">
                        {row.position} · {row.teamAbbr} · {row.metric}
                      </div>

                      {/* Live In-Game Stat Progress */}
                      {row.currentStat !== undefined && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-white">
                            {row.currentStat} / {row.line} yds
                          </span>
                          {row.result === "over" && (
                            <span className="rounded bg-[#50b848]/20 px-1 py-0.2 font-mono text-[9px] font-bold text-[#50b848]">
                              OVER HIT
                            </span>
                          )}
                          {row.result === "under" && (
                            <span className="rounded bg-rose-500/20 px-1 py-0.2 font-mono text-[9px] font-bold text-rose-400">
                              UNDER HIT
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Over / Under DraftKings Betting Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        disabled={isFinal}
                        className={`flex flex-col items-center justify-center w-20 rounded-md border py-1.5 px-2 transition-all disabled:opacity-60 ${
                          row.result === "over"
                            ? "border-[#50b848] bg-[#50b848]/20"
                            : "border-white/10 bg-[#172330] hover:border-[#50b848]/50"
                        }`}
                      >
                        <span className="font-mono text-xs font-bold text-white">O {row.line}</span>
                        <span className="font-mono text-[10px] text-[#50b848]">{row.overOdds}</span>
                      </button>

                      <button
                        disabled={isFinal}
                        className={`flex flex-col items-center justify-center w-20 rounded-md border py-1.5 px-2 transition-all disabled:opacity-60 ${
                          row.result === "under"
                            ? "border-[#50b848] bg-[#50b848]/20"
                            : "border-white/10 bg-[#172330] hover:border-[#50b848]/50"
                        }`}
                      >
                        <span className="font-mono text-xs font-bold text-white">U {row.line}</span>
                        <span className="font-mono text-[10px] text-[#50b848]">{row.underOdds}</span>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
