// Where are DraftKings' prop prices in ESPN's feed for upcoming games?
import fs from "node:fs";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? await r.json() : { _status: r.status }; } catch (e) { return { _err: String(e) }; } };
const out = {};
for (const [s, l] of [["football", "nfl"], ["basketball", "nba"], ["hockey", "nhl"]]) {
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard`);
  const ev = (sb.events ?? []).find((e) => e.competitions?.[0]?.status?.type?.state === "pre") ?? sb.events?.[0];
  if (!ev) continue;
  const base = `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${ev.id}/competitions/${ev.id}/odds`;
  const list = await get(`${base}?limit=50`);
  const providers = (list.items ?? []).map((i) => [i?.provider?.id, i?.provider?.name]);
  const res = { game: ev.shortName, providers, books: {} };
  for (const pid of [...new Set([...(list.items ?? []).map((i) => String(i?.provider?.id)), "100", "58", "59", "200", "2000"])]) {
    const pb = await get(`${base}/${pid}/propBets?limit=1000`);
    const items = pb.items ?? [];
    let full = [];
    for (const it of items.slice(0, 400)) full.push(!it.type && it.$ref ? await get(it.$ref) : it);
    const priced = full.filter((x) => JSON.stringify(x).match(/american|moneyLine|"odds"/i));
    const byType = {};
    for (const x of full) { const t = x?.type?.name ?? "?"; byType[t] ??= { n: 0, priced: 0 }; byType[t].n++; if (JSON.stringify(x).match(/american/i)) byType[t].priced++; }
    res.books[pid] = { rawPairs: full.filter((x) => x?.type?.name === "Total Points" || x?.type?.name === "Total Passing Yards (incl. overtime)").slice(0, 6), status: pb._status ?? 200, count: pb.count ?? items.length, refOnly: items.filter((x) => !x.type && x.$ref).length, pricedSample: priced.slice(0, 2), unpricedSample: full.filter((x) => !JSON.stringify(x).match(/american/i)).slice(0, 1), byType };
  }
  // also the site summary pickcenter / odds for player props?
  const sum = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/summary?event=${ev.id}`);
  res.summaryKeys = Object.keys(sum ?? {});
  out[l] = res;
}
fs.writeFileSync("probe/result.json", JSON.stringify(out, null, 1));
