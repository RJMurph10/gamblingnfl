import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Game } from "@/data/games";
import { type Team } from "@/data/teams";
import { TeamLogo } from "@/components/booth";
import { getGameProps } from "@/lib/espn.functions";
import { type PropCategory, type LivePropOffer, type GamePropBoard } from "@/lib/props.types";

interface DraftKingsPropsBoardProps {
  game: Game;
  away: Team;
  home: Team;
}

/** Group offers so each player/market shows its over-under or its milestone ladder together. */
function groupOffers(offers: LivePropOffer[]) {
  const groups = new Map<string, { head: LivePropOffer; rows: LivePropOffer[] }>();
  for (const offer of offers) {
    const key = `${offer.playerId}|${offer.market}`;
    const group = groups.get(key) ?? { head: offer, rows: [] };
    group.rows.push(offer);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ ...g, rows: g.rows.sort((x, y) => (x.line ?? 0) - (y.line ?? 0)) }));
}

export function DraftKingsPropsBoard({ game, away, home }: DraftKingsPropsBoardProps) {
  const [category, setCategory] = useState<PropCategory>("td-scorers");
  const [teamFilter, setTeamFilter] = useState<"all" | "away" | "home">("all");
  const [tdMarket, setTdMarket] = useState<"all" | "anytime" | "first" | "multi">("all");
  const [marketFilter, setMarketFilter] = useState<string>("");

  const isLive = game.status === "live" || game.status === "halftime";
  const isFinal = game.status === "final";
  const isOT = (game.period ?? 0) > 4;

  // Real DraftKings lines from ESPN; refreshed while the game is upcoming or live.
  const propsQuery = useQuery<GamePropBoard>({
    queryKey: ["game-props", game.id, away.abbr, home.abbr],
    queryFn: () => getGameProps({ data: { eventId: String(game.id), awayAbbr: away.abbr, homeAbbr: home.abbr } }),
    refetchInterval: isLive ? 15_000 : isFinal ? false : 60_000,
    staleTime: 10_000,
  });
  const board = propsQuery.data;

  // Box-score stats so live/final games can show progress and results against each line.
  const statsByName = useMemo(() => {
    const map = new Map<string, { passYds: number; rushYds: number; recYds: number; tds: number }>();
    for (const p of game.playerStats || []) {
      map.set(p.name.toLowerCase(), {
        passYds: p.passYds ?? 0,
        rushYds: p.rushYds ?? 0,
        recYds: p.recYds ?? 0,
        tds: p.touchdowns ?? 0,
      });
    }
    return map;
  }, [game.playerStats]);

  const sideOk = (offer: LivePropOffer) =>
    teamFilter === "all" ||
    (teamFilter === "away" ? offer.teamAbbr === away.abbr : offer.teamAbbr === home.abbr);

  // TD scorer table: one row per player with First / Anytime / 2+ prices.
  const tdRows = useMemo(() => {
    const rows = new Map<string, { offer: LivePropOffer; first?: string; anytime?: string; multi?: string }>();
    for (const offer of (board?.offers ?? []).filter((o) => o.category === "td" && sideOk(o))) {
      const row = rows.get(offer.playerId) ?? { offer };
      if (offer.market === "First TD") row.first = offer.overOdds;
      else if (offer.market === "2+ TDs") row.multi = offer.overOdds;
      else row.anytime = offer.overOdds;
      rows.set(offer.playerId, row);
    }
    return [...rows.values()].sort((a, b) => {
      const price = (r: { anytime?: string }) => Number(r.anytime ?? 9999);
      return price(a) - price(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, teamFilter]);

  const categoryKey = category === "td-scorers" ? "td" : category;
  const categoryOffers = (board?.offers ?? []).filter((o) => o.category === categoryKey && sideOk(o));
  const markets = [...new Set(categoryOffers.map((o) => o.market))];
  const activeMarket = markets.includes(marketFilter) ? marketFilter : markets[0] ?? "";
  const groups = groupOffers(categoryOffers.filter((o) => o.market === activeMarket));

  const currentStatFor = (offer: LivePropOffer): number | undefined => {
    if (!(isLive || isFinal)) return undefined;
    const stats = statsByName.get(offer.playerName.toLowerCase());
    if (!stats) return undefined;
    if (/passing yards/i.test(offer.market)) return stats.passYds;
    if (/rush \+ rec/i.test(offer.market)) return stats.rushYds + stats.recYds;
    if (/rushing yards/i.test(offer.market)) return stats.rushYds;
    if (/receiving yards/i.test(offer.market)) return stats.recYds;
    return undefined;
  };

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
                : "DraftKings lines via ESPN · updates every minute"}
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
        {propsQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-mute">Loading DraftKings lines…</p>
        ) : !board?.available ? (
          <div className="py-8 text-center">
            <p className="font-semibold text-white">No player props posted yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-mute">
              ESPN hasn&apos;t published DraftKings player props for this game. They usually appear closer to kickoff
              and this board refreshes on its own.
            </p>
            {board?.diagnostics ? (
              <p className="mx-auto mt-3 max-w-lg break-words rounded-md border border-white/10 bg-black/20 px-3 py-2 text-left font-mono text-[10px] text-mute">
                ESPN check · providers tried: {board.diagnostics.providersTried.join(", ") || "none"} · items returned:{" "}
                {board.diagnostics.itemCount}
                {board.diagnostics.sampleTypes.length ? ` · types: ${board.diagnostics.sampleTypes.join(", ")}` : ""}
                {board.diagnostics.error ? ` · error: ${board.diagnostics.error}` : ""}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {!board.priced ? (
              <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                ESPN lists these props, but DraftKings hasn&apos;t posted prices for them yet. Lines are shown with
                &quot;—&quot; until prices appear.
              </p>
            ) : null}

            {category === "td-scorers" ? (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["all", "All TD Markets"],
                        ["anytime", "Anytime TD"],
                        ["first", "First TD"],
                        ["multi", "2+ TDs"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTdMarket(key)}
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

                {tdRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-mute">No touchdown props posted for this game.</p>
                ) : (
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
                        {tdRows.map((row) => {
                          const scored = (statsByName.get(row.offer.playerName.toLowerCase())?.tds ?? 0) > 0;
                          const tdCount = statsByName.get(row.offer.playerName.toLowerCase())?.tds ?? 0;
                          const cell = (value?: string, hit = false) => (
                            <span
                              className={`inline-block w-20 rounded-md border py-1.5 font-mono text-xs font-bold ${
                                hit
                                  ? "border-[#50b848] bg-[#50b848]/20 text-[#50b848]"
                                  : "border-white/10 bg-[#16222f] text-[#50b848]"
                              }`}
                            >
                              {hit ? "HIT" : value ?? "—"}
                            </span>
                          );
                          return (
                            <tr key={row.offer.playerId} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  {row.offer.playerName}
                                  {scored ? (
                                    <span className="rounded bg-[#50b848]/20 px-1.5 font-mono text-[9px] font-bold text-[#50b848]">
                                      TD HIT ({tdCount})
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[11px] text-mute">
                                  {row.offer.position} · {row.offer.teamAbbr}
                                </div>
                              </td>
                              {(tdMarket === "all" || tdMarket === "first") && (
                                <td className="py-2.5 px-2 text-center">{cell(row.first)}</td>
                              )}
                              {(tdMarket === "all" || tdMarket === "anytime") && (
                                <td className="py-2.5 px-2 text-center">{cell(row.anytime, scored)}</td>
                              )}
                              {(tdMarket === "all" || tdMarket === "multi") && (
                                <td className="py-2.5 px-2 text-center">{cell(row.multi)}</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div>
                {markets.length > 1 ? (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {markets.map((market) => (
                      <button
                        key={market}
                        type="button"
                        onClick={() => setMarketFilter(market)}
                        className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all ${
                          activeMarket === market
                            ? "bg-[#1f2d3d] text-white border border-[#50b848]/50"
                            : "bg-surface/20 text-mute hover:text-foreground"
                        }`}
                      >
                        {market}
                      </button>
                    ))}
                  </div>
                ) : null}

                {groups.length === 0 ? (
                  <p className="py-6 text-center text-sm text-mute">No {category} props posted for this game.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {groups.map(({ head, rows }) => {
                      const current = currentStatFor(head);
                      return (
                        <div
                          key={`${head.playerId}-${head.market}`}
                          className="rounded-lg border border-white/10 bg-[#121c27] p-3 hover:border-white/20 transition-all"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-bold text-white text-sm truncate">{head.playerName}</div>
                              <div className="text-[11px] text-mute">
                                {head.position} · {head.teamAbbr} · {head.market}
                              </div>
                              {current !== undefined && rows[0].line !== undefined ? (
                                <div className="mt-1 flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold text-white">
                                    {current} / {rows[0].line}
                                  </span>
                                  {isFinal ? (
                                    <span
                                      className={`rounded px-1 font-mono text-[9px] font-bold ${
                                        current > rows[0].line ? "bg-[#50b848]/20 text-[#50b848]" : "bg-rose-500/20 text-rose-400"
                                      }`}
                                    >
                                      {current > rows[0].line ? "OVER HIT" : "UNDER HIT"}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            {rows[0].kind === "over-under" ? (
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex flex-col items-center justify-center w-20 rounded-md border border-white/10 bg-[#172330] py-1.5 px-2">
                                  <span className="font-mono text-xs font-bold text-white">O {rows[0].line}</span>
                                  <span className="font-mono text-[10px] text-[#50b848]">{rows[0].overOdds ?? "—"}</span>
                                </div>
                                <div className="flex flex-col items-center justify-center w-20 rounded-md border border-white/10 bg-[#172330] py-1.5 px-2">
                                  <span className="font-mono text-xs font-bold text-white">U {rows[0].line}</span>
                                  <span className="font-mono text-[10px] text-[#50b848]">{rows[0].underOdds ?? "—"}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {rows[0].kind === "milestone" ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {rows.map((row) => (
                                <div
                                  key={row.line}
                                  className={`flex flex-col items-center rounded-md border px-2.5 py-1 ${
                                    current !== undefined && row.line !== undefined && current >= row.line
                                      ? "border-[#50b848] bg-[#50b848]/20"
                                      : "border-white/10 bg-[#172330]"
                                  }`}
                                >
                                  <span className="font-mono text-xs font-bold text-white">{row.line}+</span>
                                  <span className="font-mono text-[10px] text-[#50b848]">{row.overOdds ?? "—"}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
