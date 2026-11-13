// Temporary: TD markets on tonight's WSH @ NYG, matched to the saved TD prices by name.
import { boxFrom, statsByLabel } from "../../../scripts/line-history/prop-grading.mjs";
import { gameEvents } from "../../../scripts/line-history/prop-markets.mjs";
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const get = async (u) => (await fetch(u, { headers: H })).json();
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
const s = await get("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873052");
const box = boxFrom(s, "nfl");
const ev = gameEvents(s, "nfl", box);
console.log("STATUS", s.header?.competitions?.[0]?.status?.type?.shortDetail, "EV", JSON.stringify(ev), "TD plays", (s.scoringPlays ?? []).filter((p) => p.type?.abbreviation === "TD").map((p) => p.text).join(" | "));
const fns = statsByLabel("nfl");
const board = await get("https://raw.githubusercontent.com/RJMurph10/gamblingnfl/props-site/nfl/closed/401873052.json");
const byName = new Map(Object.entries(box).map(([a, b]) => [norm(b.n), a]));
let matched = 0; const miss = [];
for (const r of board.td ?? []) {
  const a = byName.get(norm(r[0]));
  if (!a) { miss.push(r[0]); continue; }
  matched++;
  const vals = ["Anytime TD", "First TD"].map((l) => fns.get(l)(box[a].s, { a, g: { box, ev } }));
  if (vals.some((v) => v)) console.log("TD", r[0], JSON.stringify(vals));
}
console.log(`MATCH ${matched} of ${(board.td ?? []).length} TD-price players found on the box score; not found: ${miss.join(", ")}`);
