// Temporary: which books ESPN still has player props from on dates our prop history is missing.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status }; } catch (e) { return { err: String(e) }; } };
const SPORT = { mlb: "baseball/mlb", nhl: "hockey/nhl", nba: "basketball/nba", wnba: "basketball/wnba", nfl: "football/nfl", cfb: "football/college-football", cbb: "basketball/mens-college-basketball" };
const CASES = [
  ["mlb", "20240415"], ["mlb", "20240815"], ["mlb", "20240328"],
  ["nhl", "20231205"], ["nhl", "20240110"], ["nhl", "20231115"],
  ["wnba", "20240710"], ["wnba", "20240915"],
  ["cfb", "20251115"], ["cfb", "20251206"], ["cfb", "20260101"],
  ["nba", "20251215"], ["nba", "20260115"], ["nba", "20260310"],
  ["nhl", "20260115"], ["nfl", "20251214"], ["nfl", "20260111"],
  ["nfl", "20231015"], ["nfl", "20231210"], ["nba", "20231101"],
  ["cbb", "20250115"], ["cbb", "20240320"],
];
for (const [lg, d] of CASES) {
  const [sport, league] = SPORT[lg].split("/");
  const q = lg === "cfb" ? "&groups=80" : lg === "cbb" ? "&groups=50" : "";
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${d}${q}&limit=300`);
  const evs = (sb.events ?? []).filter((e) => e.status?.type?.completed).slice(0, 3);
  const out = [];
  for (const e of evs) {
    const core = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${e.id}/competitions/${e.id}/odds`;
    const odds = await get(core);
    const pids = (odds.items ?? []).map((it) => String(it?.provider?.id ?? /\/odds\/(\d+)/.exec(it?.$ref ?? "")?.[1] ?? ""));
    const counts = [];
    for (const p of pids) {
      const pb = await get(`${core}/${p}/propBets?limit=1000`);
      counts.push(`${p}:${pb.count ?? pb.status ?? "?"}`);
    }
    out.push(`${e.id}[${counts.join(",")}]`);
  }
  console.log(`CASE ${lg} ${d} games=${(sb.events ?? []).length} ${out.join(" ")}`);
}
