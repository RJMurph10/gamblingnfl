// probe: rosterFor() on a finished game, for every rostered player missing from the box score
import { rosterFor } from "../../../scripts/line-history/build-props-history.mjs";
const id = process.argv[2] ?? "401873051";
const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`)).json();
const inBox = new Set();
for (const t of s.boxscore?.players ?? []) for (const g of t.statistics ?? []) for (const a of g.athletes ?? []) inBox.add(String(a.athlete.id));
const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}`;
const comp = await (await fetch(base)).json();
const ids = new Set();
for (const c of comp.competitors) for (const e of (await (await fetch(`${base}/competitors/${c.id}/roster`)).json()).entries ?? []) if (!inBox.has(String(e.playerId))) ids.add(String(e.playerId));
console.log("box", inBox.size, "not in box", ids.size);
const out = await rosterFor(id, ids, async (u) => (await fetch(u)).json());
for (const [k, v] of Object.entries(out)) if (/Beckham|Felton|Jennings|Murray|Bell/.test(v.n)) console.log(k, JSON.stringify(v));
console.log("played without a stat:", Object.values(out).filter((v) => v.played).length, "| didn't play:", Object.values(out).filter((v) => !v.played).length);
