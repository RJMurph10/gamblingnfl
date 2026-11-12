// probe: does ESPN keep DraftKings player props for finished men's college basketball games?
const L = "basketball/leagues/mens-college-basketball";
for (const day of ["20261106", "20261110", "20260319", "20260405", "20250315", "20260222"]) {
  const sb = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${day}&groups=50&limit=300`)).json();
  const ev = sb.events ?? [];
  let withProps = 0, total = 0, sample = "";
  for (const e of ev.slice(0, 25)) {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e.id}/competitions/${e.id}/odds/100/propBets?limit=10`);
    const j = r.ok ? await r.json() : null;
    const n = j?.count ?? 0;
    if (n) { withProps++; total += n; if (!sample) sample = `${e.shortName} ${n}`; }
  }
  // which providers carry anything for the first game?
  const e0 = ev[0];
  const odds = e0 ? await (await fetch(`https://sports.core.api.espn.com/v2/sports/${L}/events/${e0.id}/competitions/${e0.id}/odds`)).json() : null;
  console.log(day, "games", ev.length, "| checked", Math.min(25, ev.length), "with DK props", withProps, "props", total, sample, "| providers", (odds?.items ?? []).map((x) => x.provider?.name).join(","));
}
// NBA control: a finished NBA game last week
const nb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261106")).json();
const n0 = nb.events?.[0];
if (n0) {
  const r = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${n0.id}/competitions/${n0.id}/odds/100/propBets?limit=10`);
  console.log("NBA control", n0.shortName, r.status, r.ok ? (await r.json()).count : "-");
}
