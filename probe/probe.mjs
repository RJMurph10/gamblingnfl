// Deep look: what do old prop items contain (lines, prices)?
import fs from "node:fs";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? await r.json() : { _status: r.status }; } catch (e) { return { _err: String(e) }; } };
const C = (s, l, id) => `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${id}/competitions/${id}/odds`;
const cases = [
  ["football","nfl","401671789","58"], ["football","nfl","401671789","59"],   // placeholder ids replaced below
];
const pick = async (s, l, day, n) => (await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${day}`)).events?.[n]?.id;
const plan = [
  ["football","nfl","20241110",["58","59"]], ["football","nfl","20231105",["45","47","48","40"]], ["football","nfl","20221106",["45","47","52"]],
  ["basketball","nba","20250115",["58","59"]], ["basketball","nba","20240115",["58","47","45"]], ["basketball","nba","20230115",["40","47","45"]],
];
const out = [];
for (const [s, l, day, provs] of plan) {
  const id = await pick(s, l, day, 0);
  for (const p of provs) {
    const all = [];
    const first = await get(`${C(s, l, id)}/${p}/propBets?limit=1000&page=1`);
    all.push(...(first.items ?? []));
    for (let pg = 2; pg <= Math.min(first.pageCount || 1, 5); pg++) all.push(...((await get(`${C(s, l, id)}/${p}/propBets?limit=1000&page=${pg}`)).items ?? []));
    const resolved = [];
    for (const it of all.slice(0, 1200)) resolved.push(!it.type && it.$ref ? await get(it.$ref) : it);
    const types = {};
    for (const x of resolved) { const t = x?.type?.name ?? "?"; types[t] = (types[t] || 0) + 1; }
    const yards = resolved.filter((x) => /pass|points|yards|rebound/i.test(x?.type?.name ?? "")).slice(0, 2);
    const provider = (await get(`https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/casinos/${p}`))?.name ?? p;
    out.push({ l, day, id, p, provider, count: resolved.length, types, examples: yards.length ? yards : resolved.slice(0, 2) });
  }
}
fs.writeFileSync("probe/result.json", JSON.stringify(out, null, 1));
console.log("done");
