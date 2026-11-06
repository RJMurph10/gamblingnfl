const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json" };
const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20241115&limit=50", { headers: H })).json();
const e = sb.events[0]; console.log("event", e.id, e.name, "season.type", e.season?.type);
for (const u of [`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${e.id}/competitions/${e.id}/odds?limit=50`]) {
  const r = await fetch(u, { headers: H }); console.log(u, r.status); const t = await r.text(); console.log(t.slice(0, 1500));
}
console.log("scoreboard odds:", JSON.stringify(e.competitions[0].odds ?? null).slice(0, 600));
