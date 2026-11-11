// Which sportsbooks does ESPN's core odds feed list per game? (line shopping probe)
const leagues = [["basketball", "nba"], ["basketball", "mens-college-basketball"], ["football", "college-football"], ["football", "nfl"]];
for (const [sport, lg] of leagues) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${lg}/scoreboard${lg === "mens-college-basketball" ? "?groups=50&limit=5" : ""}`)).json();
  const ev = (sb.events ?? []).find((e) => e.status?.type?.state === "pre") ?? sb.events?.[0];
  if (!ev) { console.log(lg, "no events"); continue; }
  const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${lg}/events/${ev.id}/competitions/${ev.id}/odds?limit=50`);
  const j = r.ok ? await r.json() : null;
  console.log(lg, ev.name, "providers:", (j?.items ?? []).map((i) => `${i.provider?.name}(${i.spread ?? "-"}/${i.overUnder ?? "-"})`).join(", "));
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${lg}/summary?event=${ev.id}`)).json();
  console.log("  summary pickcenter:", (s.pickcenter ?? []).map((p) => `${p.provider?.name}(${p.spread ?? "-"}/${p.overUnder ?? "-"})`).join(", "));
}
