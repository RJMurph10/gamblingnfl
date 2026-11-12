// probe: does ESPN publish the matchup predictor for upcoming NBA games?
const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261112")).json();
for (const e of (sb.events ?? []).slice(0, 3)) {
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${e.id}`)).json();
  console.log(e.id, e.shortName, "summary.predictor:", JSON.stringify(s.predictor ?? null).slice(0, 200));
  const c = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${e.id}/competitions/${e.id}/predictor`);
  const cj = c.ok ? await c.json() : null;
  console.log("   core predictor:", c.status, JSON.stringify(cj?.homeTeam?.statistics?.find?.((x) => x.name === "gameProjection") ?? null));
}
