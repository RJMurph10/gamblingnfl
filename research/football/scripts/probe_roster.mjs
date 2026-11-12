// probe: raw ESPN anytime / 2+ / first TD scorer items, 2023 / 2024 / 2025
const L = "football/leagues/nfl";
for (const [day, pid] of [["20231112", "40"], ["20241110", "58"], ["20251109", "58"]]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}`)).json();
  const e = sb.events?.[0];
  const j = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/${pid}/propBets?limit=1000`)).json();
  for (const t of ["Anytime Touchdown Scorer", "Player to score 2 or more touchdowns", "First Touchdown Scorer"]) {
    const it = (j.items ?? []).find((x) => x.type?.name === t);
    if (!it) { console.log("RAW", day, pid, t, "none"); continue; }
    const { competition, athlete, provider, ...rest } = it;
    console.log("RAW", day, pid, t, JSON.stringify(rest).slice(0, 700));
  }
}
