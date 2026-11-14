import { boxFrom } from "./lh/prop-grading.mjs";
import { footballPeriods } from "./lh/prop-markets.mjs";
const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261108")).json();
const sb2 = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261101")).json();
let players = 0, badPlayers = 0, badStats = {};
for (const ev of [...(sb.events ?? []), ...(sb2.events ?? [])]) {
  const id = ev.id;
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`)).json();
  const p = await (await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}/plays?limit=1000`)).json();
  const box = boxFrom(s, "nfl");
  const r = footballPeriods(p.items ?? [], box);
  const rel = Object.entries(box).filter(([, b]) => ["passing.YDS", "rushing.YDS", "receiving.YDS"].some((k) => b.s[k] != null));
  players += rel.length;
  for (const [a, b] of rel) if (r.bad[a]) { badPlayers++; for (const k of r.bad[a]) badStats[k] = (badStats[k] ?? 0) + 1; console.log(ev.shortName, b.n, r.bad[a].join(","), "plays items", (p.items ?? []).length, p.pageCount); }
}
console.log("players", players, "with any mismatch", badPlayers, JSON.stringify(badStats));
