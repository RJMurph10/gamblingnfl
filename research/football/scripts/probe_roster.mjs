// probe: ESPN core competitor roster for a finished NFL game: who played / didn't
const id = process.argv[2] ?? "401873051";
const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}`;
const j = async (u) => (await fetch(u.replace("http://", "https://"))).json();
const comp = await j(base);
for (const c of comp.competitors ?? []) {
  const r = await j(`${base}/competitors/${c.id}/roster`);
  const e = r.entries ?? [];
  console.log("team", c.id, "entries", e.length, "keys", Object.keys(e[0] ?? {}).join(","));
  for (const x of e) {
    const n = x.displayName ?? x.athlete?.$ref;
    if (/Beckham|Felton|Jefferson|Hockenson|Wentz|Murray|Jennings/.test(String(n)))
      console.log(JSON.stringify({ n, played: x.played, didNotPlay: x.didNotPlay, active: x.active, starter: x.starter, reason: x.reason, ejected: x.ejected }));
  }
  console.log("didNotPlay true:", e.filter((x) => x.didNotPlay).map((x) => x.displayName).join(", "));
}
