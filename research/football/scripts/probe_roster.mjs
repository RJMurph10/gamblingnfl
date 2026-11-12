// probe: does ESPN carry DraftKings player props for men's college basketball games?
const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261112&groups=50&limit=300")).json();
const ev = (sb.events ?? []).filter((e) => e.competitions?.[0]?.odds?.length);
console.log("games", (sb.events ?? []).length, "with odds", ev.length);
let withProps = 0;
for (const e of ev.slice(0, 40)) {
  const r = await fetch(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${e.id}/competitions/${e.id}/odds/100/propBets?limit=50`);
  const j = r.ok ? await r.json() : null;
  const n = j?.count ?? (j?.items?.length ?? 0);
  if (n) { withProps++; console.log("  props:", e.shortName, n, (j.items?.[0]?.type?.name ?? "")); }
}
console.log("checked", Math.min(40, ev.length), "games with DraftKings props:", withProps);
