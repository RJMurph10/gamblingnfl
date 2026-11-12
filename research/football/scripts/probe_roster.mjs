// probe: does ESPN publish the matchup predictor for upcoming NHL games?
const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261112")).json();
for (const e of (sb.events ?? []).slice(0, 3)) {
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=${e.id}`)).json();
  console.log(e.id, e.shortName, "summary.predictor:", JSON.stringify(s.predictor ?? null).slice(0, 200));
  const c = await fetch(`https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/${e.id}/competitions/${e.id}/predictor`);
  const cj = c.ok ? await c.json() : null;
  console.log("   core predictor:", c.status, JSON.stringify(cj?.homeTeam?.statistics?.find?.((x) => x.name === "gameProjection") ?? null));
}
