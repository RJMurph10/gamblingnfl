// Temporary: WNBA 2024 ESPN BET props: which days have them and which markets.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status }; } catch (e) { return { err: String(e) }; } };
const line = []; const markets = {};
for (let t = Date.UTC(2024, 4, 14); t <= Date.UTC(2024, 9, 20); t += 86400000 * 4) {
  const d = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${d}`);
  const e = (sb.events ?? []).find((x) => x.status?.type?.completed);
  if (!e) continue;
  const pb = await get(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/events/${e.id}/competitions/${e.id}/odds/58/propBets?limit=1000`);
  line.push(`${d.slice(4)}:${pb.count ?? pb.status}`);
  for (const it of pb.items ?? []) { const k = it.type?.name ?? "?"; markets[k] = (markets[k] ?? 0) + 1; }
}
console.log("WNBA24", line.join(" "));
console.log("MARKETS", JSON.stringify(markets));
