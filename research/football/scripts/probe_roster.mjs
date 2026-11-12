// probe: how far back does ESPN keep DraftKings MLB prop prices?
const L = "baseball/leagues/mlb";
for (const day of ["20260401", "20250615", "20250915", "20240615", "20240915"]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${day}`)).json();
  let ok = 0, n = 0;
  for (const e of (sb.events ?? []).slice(0, 4)) {
    n++;
    const odds = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds`)).json();
    const prov = (odds.items ?? []).map((x) => x.provider?.id + ":" + x.provider?.name).join(",");
    let line = "";
    for (const pid of ["100", "40", "58"]) {
      const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/${pid}/propBets?limit=5`);
      if (!r.ok) continue;
      const j = await r.json();
      const x = j.items?.[0];
      if (j.count) { line += ` p${pid}=${j.count} am=${JSON.stringify(x?.odds?.american ?? null)}`; if (x?.odds?.american?.value) ok++; }
    }
    if (n === 1) console.log(day, e.shortName, "providers", prov, line);
  }
  console.log(day, "games checked", n, "with priced props", ok);
}
