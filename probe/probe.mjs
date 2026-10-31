// Does ESPN still serve DraftKings player props for games that finished long ago?
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/json", Referer: "https://www.espn.com/", Origin: "https://www.espn.com" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return { status: r.status, json: r.ok ? await r.json() : null }; } catch (e) { return { status: String(e), json: null }; } };
const L = { nfl: ["football", "nfl"], nba: ["basketball", "nba"], nhl: ["hockey", "nhl"], mlb: ["baseball", "mlb"], cfb: ["football", "college-football"] };
const probes = [["nfl","20231105"],["nfl","20241110"],["nfl","20251102"],["nfl","20221106"],["nba","20240115"],["nba","20250115"],["nba","20230115"],["nhl","20250115"],["mlb","20250615"],["mlb","20240615"],["cfb","20241109"]];
const out = [];
for (const [lg, day] of probes) {
  const [s, l] = L[lg];
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${day}`);
  for (const ev of (sb.json?.events ?? []).slice(0, 2)) {
    const base = `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${ev.id}/competitions/${ev.id}/odds`;
    const odds = await get(`${base}?limit=50`);
    const providers = (odds.json?.items ?? []).map((i) => i?.provider?.id ?? (i.$ref ?? "").match(/odds\/(\d+)/)?.[1]);
    const pb = await get(`${base}/100/propBets?limit=400&page=1`);
    let sample = pb.json?.items?.[0];
    if (sample && !sample.type && sample.$ref) sample = (await get(sample.$ref)).json;
    out.push({ lg, day, id: ev.id, name: ev.shortName, oddsStatus: odds.status, providers, propStatus: pb.status, propCount: pb.json?.count ?? pb.json?.items?.length ?? 0, pageCount: pb.json?.pageCount, sample });
  }
}
await import("node:fs").then((fs) => fs.writeFileSync("probe/result.json", JSON.stringify(out, null, 1)));
console.log(out.map((o) => `${o.lg} ${o.day} ${o.name}: odds ${o.oddsStatus} providers ${o.providers} | props ${o.propStatus} count ${o.propCount}`).join("\n"));
