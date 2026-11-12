// probe: does ESPN keep sportsbook player props for finished WNBA games? (2024, 2025, 2026)
const L = "basketball/leagues/wnba";
for (const day of ["20240615", "20240825", "20260620", "20260815"]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${day}`)).json();
  for (const e of (sb.events ?? []).slice(0, 1)) {
    const odds = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds`)).json();
    const provs = (odds.items ?? []).map((x) => x.provider?.id).filter(Boolean);
    let line = "";
    for (const pid of [...new Set([...provs, "100", "58"])]) {
      const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/${pid}/propBets?limit=1000`);
      if (!r.ok) continue;
      const j = await r.json();
      if (!j.count) continue;
      const items = j.items ?? [];
      const types = [...new Set(items.map((x) => x.type?.name))].join("; ");
      const priced = items.filter((x) => x.odds?.american?.value != null || x.current?.over || x.odds?.over).length;
      line += ` | p${pid}: ${j.count} props, ${priced} priced [${types}]`;
    }
    console.log("WNBA", day, e.shortName, line || " | no props");
  }
}
