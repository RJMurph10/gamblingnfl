// probe: NFL touchdown-scorer props on ESPN for finished games (2023, 2024, 2025, 2026)
const L = "football/leagues/nfl";
for (const day of ["20231112", "20241110", "20251109", "20261108"]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}`)).json();
  const e = sb.events?.[0];
  if (!e) continue;
  const odds = await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds`)).json();
  const provs = [...new Set([...(odds.items ?? []).map((x) => x.provider?.id), "100", "58"])].filter(Boolean);
  for (const pid of provs) {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/${pid}/propBets?limit=1000`);
    if (!r.ok) continue;
    const j = await r.json();
    const td = (j.items ?? []).filter((x) => /touchdown|td scorer|first td|anytime/i.test(x.type?.name ?? ""));
    const types = [...new Set(td.map((x) => x.type?.name))].join("; ");
    const priced = td.filter((x) => x.odds?.american?.value != null || x.current?.yes || x.odds?.yes || x.odds?.american).length;
    if (j.count) console.log("NFL", day, e.shortName, `p${pid}`, j.count, "props;", td.length, "TD-type,", priced, "priced", `[${types}]`, JSON.stringify(td[0]?.odds ?? td[0]?.current ?? null).slice(0, 160));
  }
}
