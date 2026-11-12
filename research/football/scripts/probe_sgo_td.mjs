// probe: SportsGameOdds NFL player stat ids (defense / kicking / longest) with DraftKings prices (1 event)
const r = await fetch("https://api.sportsgameodds.com/v2/events/?leagueID=NFL&oddsAvailable=true&limit=1", { headers: { "X-Api-Key": process.env.SPORTSGAMEODDS_API_KEY } });
const e = (await r.json()).data?.[0];
const k = {};
for (const m of Object.values(e?.odds ?? {})) {
  if (!m.playerID || m.periodID !== "game") continue;
  const key = `${m.statID}|${m.betTypeID}|${m.sideID}`;
  k[key] ??= [0, 0];
  k[key][0]++;
  if (m.byBookmaker?.draftkings) k[key][1]++;
}
console.log("SGO", Object.entries(k).filter(([x]) => !/passing_|rushing_|receiving_|touchdown|Touchdown/.test(x)).map(([x, [n, d]]) => `${x} ${d}/${n}`).join(" ; "));
