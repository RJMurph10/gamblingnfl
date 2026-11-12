// probe: do ESPN's DraftKings NFL props for finished 2026 games carry prices (odds.american)?
const L = "football/leagues/nfl";
for (const id of ["401873051"]) {
  const j = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${id}/competitions/${id}/odds/100/propBets?limit=1000`)).json();
  const items = j.items ?? [];
  const types = {};
  for (const x of items) {
    const t = x.type?.name; types[t] ??= [0, 0];
    types[t][0]++; if (x.odds?.american?.value != null) types[t][1]++;
  }
  console.log("count", j.count, "items", items.length);
  for (const [t, [n, p]] of Object.entries(types)) console.log("  ", t, n, "priced", p);
  console.log("  sample", JSON.stringify(items.find((x) => /Receiving Yards/i.test(x.type?.name ?? ""))?.odds ?? null));
}
