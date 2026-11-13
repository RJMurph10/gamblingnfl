// Temporary: live props grading on real ESPN games (what the site's getLiveProps does).
import { boxFrom, gradeSpecial, specialLabels, statsByLabel } from "../../../scripts/line-history/prop-grading.mjs";
import { gameEvents } from "../../../scripts/line-history/prop-markets.mjs";
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
const SPORT = { nba: "basketball/nba", nhl: "hockey/nhl", nfl: "football/nfl" };
function grade(summary, league) {
  const box = boxFrom(summary, league);
  const ev = gameEvents(summary, league, box) ?? undefined;
  const g = { box, ev };
  const out = [], sp = [];
  const fns = statsByLabel(league);
  for (const [a, bx] of Object.entries(box)) {
    for (const [label, fn] of fns) { const v = bx.dnp ? "dnp" : fn(bx.s ?? {}, { a, g }); if (v != null) out.push([bx.n, label, v]); }
    for (const label of specialLabels(league)) { const r = gradeSpecial(label, a, g); if (r === 1) sp.push([bx.n, label]); }
  }
  return { out, sp, ev };
}
for (const league of ["nba", "nhl"]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${SPORT[league]}/scoreboard`);
  for (const e of sb.events ?? []) {
    const st = e.status?.type;
    console.log(`GAME ${league} ${e.id} ${e.shortName} ${st?.state} ${st?.shortDetail}`);
  }
  const pick = (sb.events ?? []).find((e) => e.status?.type?.state === "in") ?? (sb.events ?? []).find((e) => e.status?.type?.state === "post");
  if (!pick) continue;
  const s = await get(`https://site.api.espn.com/apis/site/v2/sports/${SPORT[league]}/summary?event=${pick.id}`);
  const r = grade(s, league);
  console.log(`LIVE ${league} ${pick.shortName} ${pick.status?.type?.shortDetail}: ${r.out.length} stats, specials won ${JSON.stringify(r.sp.slice(0, 6))}`);
  console.log("  sample", JSON.stringify(r.out.filter((x) => /Points|Goals|Shots on goal|Rebounds/.test(x[1])).slice(0, 12)));
  console.log("  ev", JSON.stringify(r.ev).slice(0, 200));
}
// a finished game vs the saved results
const day = await get("https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nba/index.json");
const season = Object.keys(day.seasons ?? {}).sort().pop();
const d = day.seasons[season].slice(-1)[0];
const games = await get(`https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nba/${season}/${d}.json`);
const gsave = games[0];
const s = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gsave.id}`);
const r = grade(s, "nba");
const live = new Map(r.out.map(([p, l, v]) => [`${p}|${l}`, v]));
let same = 0, diff = 0; const diffs = [];
for (const row of gsave.props) { const k = `${row[0]}|${row[2]}`; const saved = row[7] ? "dnp" : row[6]; const now = live.get(k) ?? null; if (saved === now) same++; else { diff++; diffs.push([k, saved, now]); } }
console.log(`CHECK ${gsave.name} ${d}: ${same} match the saved results, ${diff} differ ${JSON.stringify(diffs.slice(0, 5))}`);
