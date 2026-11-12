// probe: one 2026 DraftKings anytime-TD item in full, plus how many anytime-TD items have any price
const L = "football/leagues/nfl";
for (const id of ["401873051"]) {
  const j = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${id}/competitions/${id}/odds/100/propBets?limit=1000`)).json();
  const at = (j.items ?? []).filter((x) => /Anytime Touchdown/i.test(x.type?.name ?? ""));
  console.log("ANYTIME items", at.length);
  console.log("ITEM", JSON.stringify(at[0]).slice(0, 900));
  const hasPrice = at.filter((x) => JSON.stringify(x.odds ?? {}).match(/american|decimal|value/) && !JSON.stringify(x.odds ?? {}).match(/^\{"target/)).length;
  console.log("with any odds field", hasPrice);
}
// 2025 ESPN BET anytime TD sample
const j2 = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/401772894/competitions/401772894/odds/58/propBets?limit=1000`)).json();
const a2 = (j2.items ?? []).filter((x) => /Anytime Touchdown/i.test(x.type?.name ?? ""));
console.log("2025 ANYTIME", a2.length, JSON.stringify(a2[0]?.odds ?? null).slice(0, 300));
