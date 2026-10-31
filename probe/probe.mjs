// Which markets have lines + prices, per season? Are list items $ref-only?
import fs from "node:fs";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? await r.json() : null; } catch { return null; } };
const C = (s, l, id) => `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${id}/competitions/${id}/odds`;
const plan = [["football","nfl","20241110","58"],["football","nfl","20251102","58"],["basketball","nba","20250115","58"],["basketball","nba","20240115","58"],["basketball","nba","20230115","40"],["basketball","nba","20231115","58"],["football","nfl","20240915","58"],["hockey","nhl","20250115","58"],["baseball","mlb","20250615","58"]];
const out = [];
const t0 = Date.now();
let req = 0;
for (const [s, l, day, p] of plan) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${day}`); req++;
  const id = sb?.events?.[1]?.id ?? sb?.events?.[0]?.id;
  const first = await get(`${C(s, l, id)}/${p}/propBets?limit=1000&page=1`); req++;
  const items = [...(first?.items ?? [])];
  for (let pg = 2; pg <= Math.min(first?.pageCount || 1, 5); pg++) { items.push(...((await get(`${C(s, l, id)}/${p}/propBets?limit=1000&page=${pg}`))?.items ?? [])); req++; }
  const refOnly = items.filter((x) => !x.type && x.$ref).length;
  const resolved = [];
  for (let i = 0; i < items.length; i += 25) {
    const chunk = await Promise.all(items.slice(i, i + 25).map((x) => (!x.type && x.$ref ? (req++, get(x.$ref)) : x)));
    resolved.push(...chunk.filter(Boolean));
  }
  const types = {};
  for (const x of resolved) {
    const t = x?.type?.name ?? "?";
    const priced = Boolean(x?.odds?.american?.value || x?.current?.over?.american || x?.current?.under?.american);
    const lined = x?.current?.target?.value != null || x?.odds?.total?.value != null;
    types[t] ??= { n: 0, priced: 0, lined: 0, players: new Set() };
    types[t].n++; if (priced) types[t].priced++; if (lined) types[t].lined++;
    types[t].players.add(x?.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1]);
  }
  for (const v of Object.values(types)) v.players = v.players.size;
  out.push({ l, day, id, p, total: items.length, refOnly, types });
}
fs.writeFileSync("probe/result.json", JSON.stringify({ secs: (Date.now() - t0) / 1000, req, out }, null, 1));
