import { writeFileSync } from "node:fs";
const ids = ["401772510", "401872656"];
const out = {};
for (const id of ids) {
  const s = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`)).json();
  const p = await (await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${id}/competitions/${id}/plays?limit=1000`)).json();
  out[id] = { summary: { boxscore: s.boxscore, drives: s.drives, header: s.header }, plays: p };
  console.log(id, p.count, p.pageCount, (p.items ?? []).length);
}
writeFileSync("espn_plays.json", JSON.stringify(out));
