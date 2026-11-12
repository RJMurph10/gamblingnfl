// probe: do ESPN's DraftKings MLB player props carry over/under prices, for finished games?
const L = "baseball/leagues/mlb";
for (const day of ["20261028", "20260915", "20260704"]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${day}`)).json();
  const e = sb.events?.[0];
  if (!e) { console.log(day, "no games"); continue; }
  const j = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/100/propBets?limit=400`)).json();
  const items = j.items ?? [];
  const priced = items.filter((x) => x?.odds?.american?.value != null || x?.odds?.decimal != null || x?.current?.target?.value != null);
  console.log(day, e.shortName, "props", j.count, "items", items.length);
  for (const x of items.slice(0, 3)) console.log("  ", JSON.stringify({ type: x.type?.name, athlete: x.athlete?.$ref?.split("/").pop(), odds: x.odds, current: x.current, open: x.open }).slice(0, 400));
}
