// Prints what ESPN's college game summary holds (to find the officiating crew).
for (const id of ["401777353", "401628505", "332432132"]) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${id}`);
  const s = r.ok ? await r.json() : null;
  console.log(id, r.status, "top:", Object.keys(s ?? {}).join(","));
  console.log("  gameInfo:", JSON.stringify(s?.gameInfo ?? null).slice(0, 600));
}
const core = await fetch("https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/401777353/competitions/401777353/officials");
console.log("core officials", core.status, (await core.text()).slice(0, 800));
