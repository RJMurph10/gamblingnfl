// Probe: what opening-line fields ESPN's scoreboard and core odds give for today's NBA, NFL, NHL and college games.
const get = async (u) => (await fetch(u)).json();
for (const [sport, league] of [["basketball", "nba"], ["football", "nfl"], ["hockey", "nhl"], ["basketball", "mens-college-basketball"]]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
  const ev = (sb.events ?? []).find((e) => e.competitions?.[0]?.odds?.length) ?? sb.events?.[0];
  console.log(`\n==== ${league}: ${ev?.name} ${ev?.date} status=${ev?.status?.type?.state}`);
  const o = ev?.competitions?.[0]?.odds?.[0];
  console.log("scoreboard odds keys:", o && Object.keys(o));
  console.log("scoreboard odds:", JSON.stringify(o)?.slice(0, 2500));
  if (ev) {
    const core = await get(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${ev.id}/competitions/${ev.id}/odds?limit=5`);
    let it = core.items?.[0];
    if (it && !it.provider && it.$ref) it = await get(it.$ref);
    console.log("core item keys:", it && Object.keys(it));
    console.log("core open:", JSON.stringify(it?.open)?.slice(0, 600));
    console.log("core homeTeamOdds.open:", JSON.stringify(it?.homeTeamOdds?.open)?.slice(0, 600));
  }
}
