import { useState } from "react";
import { type Game } from "@/data/games";
import { type Team } from "@/data/teams";
import { TeamLogo } from "@/components/booth";

type PropCategory = "td-scorers" | "passing" | "rushing" | "receiving";

interface DraftKingsPropsBoardProps {
  game: Game;
  away: Team;
  home: Team;
}

export function DraftKingsPropsBoard({ game, away, home }: DraftKingsPropsBoardProps) {
  const [category, setCategory] = useState<PropCategory>("td-scorers");
  const [teamFilter, setTeamFilter] = useState<"all" | "away" | "home">("all");

  // Sub-market pill selections within each category
  const [tdMarket, setTdMarket] = useState<"all" | "anytime" | "first" | "multi">("all");
  const [passingMetric, setPassingMetric] = useState<"yards" | "tds" | "completions" | "ints">("yards");
  const [rushingMetric, setRushingMetric] = useState<"yards" | "attempts" | "longest">("yards");
  const [receivingMetric, setReceivingMetric] = useState<"yards" | "receptions" | "longest">("yards");

  // Sample DraftKings prop lines aligned with the matchup rosters
  const tdScorerRows = [
    { name: "Kenneth Walker III", team: away.abbr, pos: "RB", first: "+450", anytime: "-110", multi: "+475" },
    { name: "Javonte Williams", team: home.abbr, pos: "RB", first: "+550", anytime: "+125", multi: "+650" },
    { name: "DK Metcalf", team: away.abbr, pos: "WR", first: "+600", anytime: "+145", multi: "+750" },
    { name: "Courtland Sutton", team: home.abbr, pos: "WR", first: "+700", anytime: "+165", multi: "+900" },
    { name: "Jaxon Smith-Njigba", team: away.abbr, pos: "WR", first: "+800", anytime: "+195", multi: "+1100" },
    { name: "Zach Charbonnet", team: away.abbr, pos: "RB", first: "+950", anytime: "+225", multi: "+1300" },
    { name: "Bo Nix", team: home.abbr, pos: "QB", first: "+1200", anytime: "+280", multi: "+1800" },
    { name: "Geno Smith", team: away.abbr, pos: "QB", first: "+1600", anytime: "+425", multi: "+2800" },
    { name: "Noah Fant", team: away.abbr, pos: "TE", first: "+1400", anytime: "+340", multi: "+2200" },
    { name: "Greg Dulcich", team: home.abbr, pos: "TE", first: "+1500", anytime: "+360", multi: "+2400" },
  ].filter((p) => {
    if (teamFilter === "away") return p.team === away.abbr;
    if (teamFilter === "home") return p.team === home.abbr;
    return true;
  });

  const passingRows = [
    {
      name: "Geno Smith",
      team: away.abbr,
      pos: "QB",
      metric: passingMetric,
      line: passingMetric === "yards" ? "238.5" : passingMetric === "tds" ? "1.5" : passingMetric === "completions" ? "21.5" : "0.5",
      overOdds: passingMetric === "yards" ? "-115" : passingMetric === "tds" ? "-130" : "-110",
      underOdds: passingMetric === "yards" ? "-115" : passingMetric === "tds" ? "+100" : "-120",
    },
    {
      name: "Bo Nix",
      team: home.abbr,
      pos: "QB",
      metric: passingMetric,
      line: passingMetric === "yards" ? "208.5" : passingMetric === "tds" ? "1.5" : passingMetric === "completions" ? "19.5" : "0.5",
      overOdds: passingMetric === "yards" ? "-115" : passingMetric === "tds" ? "+125" : "-115",
      underOdds: passingMetric === "yards" ? "-115" : passingMetric === "tds" ? "-160" : "-115",
    },
  ].filter((p) => {
    if (teamFilter === "away") return p.team === away.abbr;
    if (teamFilter === "home") return p.team === home.abbr;
    return true;
  });

  const rushingRows = [
    {
      name: "Kenneth Walker III",
      team: away.abbr,
      pos: "RB",
      line: rushingMetric === "yards" ? "68.5" : rushingMetric === "attempts" ? "15.5" : "15.5",
      overOdds: "-115",
      underOdds: "-115",
    },
    {
      name: "Javonte Williams",
      team: home.abbr,
      pos: "RB",
      line: rushingMetric === "yards" ? "52.5" : rushingMetric === "attempts" ? "12.5" : "13.5",
      overOdds: "-110",
      underOdds: "-120",
    },
    {
      name: "Zach Charbonnet",
      team: away.abbr,
      pos: "RB",
      line: rushingMetric === "yards" ? "28.5" : rushingMetric === "attempts" ? "6.5" : "10.5",
      overOdds: "-115",
      underOdds: "-115",
    },
    {
      name: "Jaleel McLaughlin",
      team: home.abbr,
      pos: "RB",
      line: rushingMetric === "yards" ? "24.5" : rushingMetric === "attempts" ? "5.5" : "9.5",
      overOdds: "-105",
      underOdds: "-125",
    },
    {
      name: "Bo Nix",
      team: home.abbr,
      pos: "QB",
      line: rushingMetric === "yards" ? "22.5" : rushingMetric === "attempts" ? "4.5" : "11.5",
      overOdds: "-115",
      underOdds: "-115",
    },
  ].filter((p) => {
    if (teamFilter === "away") return p.team === away.abbr;
    if (teamFilter === "home") return p.team === home.abbr;
    return true;
  });

  const receivingRows = [
    {
      name: "DK Metcalf",
      team: away.abbr,
      pos: "WR",
      line: receivingMetric === "yards" ? "64.5" : receivingMetric === "receptions" ? "5.5" : "23.5",
      overOdds: "-115",
      underOdds: "-115",
    },
    {
      name: "Courtland Sutton",
      team: home.abbr,
      pos: "WR",
      line: receivingMetric === "yards" ? "51.5" : receivingMetric === "receptions" ? "4.5" : "20.5",
      overOdds: "-115",
      underOdds: "-115",
    },
    {
      name: "Jaxon Smith-Njigba",
      team: away.abbr,
      pos: "WR",
      line: receivingMetric === "yards" ? "48.5" : receivingMetric === "receptions" ? "4.5" : "18.5",
      overOdds: "-110",
      underOdds: "-120",
    },
    {
      name: "Tyler Lockett",
      team: away.abbr,
      pos: "WR",
      line: receivingMetric === "yards" ? "38.5" : receivingMetric === "receptions" ? "3.5" : "16.5",
      overOdds: "-115",
      underOdds: "-115",
    },
    {
      name: "Josh Reynolds",
      team: home.abbr,
      pos: "WR",
      line: receivingMetric === "yards" ? "32.5" : receivingMetric === "receptions" ? "2.5" : "15.5",
      overOdds: "-115",
      underOdds: "-115",
    },
  ].filter((p) => {
    if (teamFilter === "away") return p.team === away.abbr;
    if (teamFilter === "home") return p.team === home.abbr;
    return true;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-line/10 bg-[#0e141b] shadow-2xl">
      {/* DraftKings Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c2734] bg-[#121922] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-[#55b843] font-mono text-xs font-black text-black">
            DK
          </span>
          <span className="font-disp text-sm font-bold uppercase tracking-wider text-white">
            DraftKings Sportsbook Player Props
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#7e8f9f]">
          {game.status === "live" ? "Live Lines" : "Consensus Market Odds"}
        </span>
      </div>

      {/* Main Category Sub-tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[#1c2734] bg-[#0c1117] p-2">
        {(
          [
            ["td-scorers", "TD Scorers"],
            ["passing", "Passing"],
            ["rushing", "Rushing"],
            ["receiving", "Receiving"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCategory(id)}
            className={`whitespace-nowrap rounded-md px-3.5 py-1.5 font-disp text-xs font-bold uppercase tracking-wider transition-colors ${
              category === id
                ? "bg-[#55b843] text-black shadow-sm"
                : "text-[#8ea2b4] hover:bg-[#16212d] hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter Row: Team Toggle & Metric Sub-Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#18232f] bg-[#101720] px-4 py-2.5">
        {/* Metric Selector depending on category */}
        <div className="flex flex-wrap items-center gap-1.5">
          {category === "td-scorers" && (
            <>
              {(
                [
                  ["all", "All Markets"],
                  ["anytime", "Anytime TD"],
                  ["first", "First TD"],
                  ["multi", "2+ TDs"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTdMarket(m)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    tdMarket === m
                      ? "bg-[#253545] text-white ring-1 ring-[#55b843]"
                      : "bg-[#141d27] text-[#7e8f9f] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}

          {category === "passing" && (
            <>
              {(
                [
                  ["yards", "Passing Yards"],
                  ["tds", "Passing Touchdowns"],
                  ["completions", "Completions"],
                  ["ints", "Interceptions"],
                ] as const
              ).map(([metric, label]) => (
                <button
                  key={metric}
                  type="button"
                  onClick={() => setPassingMetric(metric)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    passingMetric === metric
                      ? "bg-[#253545] text-white ring-1 ring-[#55b843]"
                      : "bg-[#141d27] text-[#7e8f9f] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}

          {category === "rushing" && (
            <>
              {(
                [
                  ["yards", "Rushing Yards"],
                  ["attempts", "Rush Attempts"],
                  ["longest", "Longest Rush"],
                ] as const
              ).map(([metric, label]) => (
                <button
                  key={metric}
                  type="button"
                  onClick={() => setRushingMetric(metric)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    rushingMetric === metric
                      ? "bg-[#253545] text-white ring-1 ring-[#55b843]"
                      : "bg-[#141d27] text-[#7e8f9f] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}

          {category === "receiving" && (
            <>
              {(
                [
                  ["yards", "Receiving Yards"],
                  ["receptions", "Receptions"],
                  ["longest", "Longest Reception"],
                ] as const
              ).map(([metric, label]) => (
                <button
                  key={metric}
                  type="button"
                  onClick={() => setReceivingMetric(metric)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    receivingMetric === metric
                      ? "bg-[#253545] text-white ring-1 ring-[#55b843]"
                      : "bg-[#141d27] text-[#7e8f9f] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Team Filters */}
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-[#617384]">
            Team:
          </span>
          {(
            [
              ["all", "All"],
              ["away", away.abbr],
              ["home", home.abbr],
            ] as const
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setTeamFilter(f)}
              className={`rounded px-2 py-0.5 font-disp text-xs font-bold uppercase tracking-wider transition-colors ${
                teamFilter === f
                  ? "bg-[#1f2d3a] text-[#55b843] border border-[#55b843]/40"
                  : "bg-transparent text-[#7e8f9f] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="p-3">
        {category === "td-scorers" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-sm">
              <thead>
                <tr className="border-b border-[#1c2734] text-[11px] uppercase tracking-wider text-[#7e8f9f]">
                  <th className="py-2 pl-3 font-disp font-semibold">Player</th>
                  {(tdMarket === "all" || tdMarket === "first") && (
                    <th className="py-2 text-center font-disp font-semibold">First TD</th>
                  )}
                  {(tdMarket === "all" || tdMarket === "anytime") && (
                    <th className="py-2 text-center font-disp font-semibold">Anytime TD</th>
                  )}
                  {(tdMarket === "all" || tdMarket === "multi") && (
                    <th className="py-2 text-center font-disp font-semibold">2+ TDs</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16212c]">
                {tdScorerRows.map((p, idx) => (
                  <tr key={idx} className="hover:bg-[#131b24] transition-colors">
                    <td className="py-3 pl-3">
                      <div className="font-disp font-bold text-white text-base leading-tight">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-[#7e8f9f] uppercase tracking-wider">
                        {p.pos} · {p.team}
                      </div>
                    </td>
                    {(tdMarket === "all" || tdMarket === "first") && (
                      <td className="py-2 px-1 text-center">
                        <button
                          type="button"
                          className="h-10 w-24 rounded-md border border-[#2a3c50] bg-[#16222f] font-mono text-sm font-bold text-white shadow-sm transition hover:border-[#55b843] hover:bg-[#1c2c3e]"
                        >
                          {p.first}
                        </button>
                      </td>
                    )}
                    {(tdMarket === "all" || tdMarket === "anytime") && (
                      <td className="py-2 px-1 text-center">
                        <button
                          type="button"
                          className="h-10 w-24 rounded-md border border-[#2a3c50] bg-[#16222f] font-mono text-sm font-bold text-white shadow-sm transition hover:border-[#55b843] hover:bg-[#1c2c3e]"
                        >
                          {p.anytime}
                        </button>
                      </td>
                    )}
                    {(tdMarket === "all" || tdMarket === "multi") && (
                      <td className="py-2 px-1 text-center">
                        <button
                          type="button"
                          className="h-10 w-24 rounded-md border border-[#2a3c50] bg-[#16222f] font-mono text-sm font-bold text-white shadow-sm transition hover:border-[#55b843] hover:bg-[#1c2c3e]"
                        >
                          {p.multi}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* 2-Way Over / Under Betting Board (Passing, Rushing, Receiving) */
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-sm">
              <thead>
                <tr className="border-b border-[#1c2734] text-[11px] uppercase tracking-wider text-[#7e8f9f]">
                  <th className="py-2 pl-3 font-disp font-semibold">Player</th>
                  <th className="py-2 text-center font-disp font-semibold w-32">Over</th>
                  <th className="py-2 text-center font-disp font-semibold w-32">Under</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16212c]">
                {(category === "passing"
                  ? passingRows
                  : category === "rushing"
                  ? rushingRows
                  : receivingRows
                ).map((row, idx) => (
                  <tr key={idx} className="hover:bg-[#131b24] transition-colors">
                    <td className="py-3 pl-3">
                      <div className="font-disp font-bold text-white text-base leading-tight">
                        {row.name}
                      </div>
                      <div className="text-[11px] text-[#7e8f9f] uppercase tracking-wider">
                        {row.pos} · {row.team}
                      </div>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <button
                        type="button"
                        className="flex h-11 w-full max-w-[140px] mx-auto flex-col items-center justify-center rounded-md border border-[#2a3c50] bg-[#16222f] shadow-sm transition hover:border-[#55b843] hover:bg-[#1c2c3e]"
                      >
                        <span className="font-mono text-xs font-bold text-white">
                          O {row.line}
                        </span>
                        <span className="font-mono text-[11px] text-[#55b843]">
                          {row.overOdds}
                        </span>
                      </button>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <button
                        type="button"
                        className="flex h-11 w-full max-w-[140px] mx-auto flex-col items-center justify-center rounded-md border border-[#2a3c50] bg-[#16222f] shadow-sm transition hover:border-[#55b843] hover:bg-[#1c2c3e]"
                      >
                        <span className="font-mono text-xs font-bold text-white">
                          U {row.line}
                        </span>
                        <span className="font-mono text-[11px] text-[#55b843]">
                          {row.underOdds}
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
