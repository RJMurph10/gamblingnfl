// Does ESPN still serve DraftKings player props for games that finished long ago?
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return { status: r.status, json: r.ok ? await r.json() : null }; } catch (e) { return { status: String(e), json: null }; } };
const L = { nfl: ["football", "nfl"], nba: ["basketball", "nba"], nhl: ["hockey", "nhl"], mlb: ["baseball", "mlb"], cfb: ["football", "college-football"] };
const probes = [["nfl","20231105"],["nfl","20241110"],["nfl","20251102"],["nfl","20221106"],["nba","20240115"],["nba","20250115"],["nba","20230115"],["nhl","20250115"],["mlb","20250615"],["mlb","20240615"],["cfb","20241109"],["nfl","20261026"],["nba","20261029"],["nfl","20261102"]];
const out = [];
for (const [lg, day] of probes) {
  const [s, l] = L[lg];
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${day}`);
  for (const ev of (sb.json?.events ?? []).slice(0, 2)) {
    const base = `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${ev.id}/competitions/${ev.id}/odds`;
    const odds = await get(`${base}?limit=50`);
    const providers = (odds.json?.items ?? []).map((i) => i?.provider?.id ?? (i.$ref ?? "").match(/odds\/(\d+)/)?.[1]);
    const byProvider = {};
    let sample = null;
    for (const pid of [...new Set([...providers.filter(Boolean), "100", "58", "59", "2000"])]) {
      const pb = await get(`${base}/${pid}/propBets?limit=400&page=1`);
      byProvider[pid] = pb.status === 200 ? (pb.json?.count ?? pb.json?.items?.length ?? 0) : pb.status;
      if (!sample && pb.json?.items?.length) { sample = pb.json.items[0]; if (!sample.type && sample.$ref) sample = (await get(sample.$ref)).json; }
    }
    out.push({ lg, day, id: ev.id, name: ev.shortName, oddsStatus: odds.status, providers, byProvider, sample });
  }
}
await import("node:fs").then((fs) => fs.writeFileSync("probe/result.json", JSON.stringify(out, null, 1)));
console.log(JSON.stringify(out.map((o) => [o.lg, o.day, o.name, o.byProvider])));
