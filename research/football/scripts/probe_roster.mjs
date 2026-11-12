// probe: ESPN's status for the Tue Nov 10 MAC games, by week and by date
for (const url of [
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&dates=20261110",
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&week=11&dates=2026&seasontype=2&limit=400",
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&week=12&dates=2026&seasontype=2&limit=400",
]) {
  const d = await (await fetch(url)).json();
  console.log("URL", url.split("?")[1], "events", (d.events ?? []).length, "week", d.week?.number);
  for (const e of d.events ?? [])
    if (/Akron|Bowling|Miami \(OH\)|RedHawks|Zips|Falcons/.test(e.name))
      console.log("  ", e.id, e.date, e.shortName, e.status?.type?.name, e.status?.type?.state, e.week?.number ?? "");
}
const cal = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80")).json();
const reg = (cal.leagues?.[0]?.calendar ?? []).find((c) => c.value === "2");
console.log("calendar weeks:", JSON.stringify((reg?.entries ?? []).filter((w) => /1[0-3]/.test(w.value)).map((w) => [w.value, w.startDate, w.endDate])));
