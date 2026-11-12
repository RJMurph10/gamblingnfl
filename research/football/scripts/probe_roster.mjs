// Temporary: ESPN odds (game lines + player props) by provider for sports the site doesn't pull props for.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status }; } catch (e) { return { err: String(e) }; } };
const CASES = [
  ["hockey", "mens-college-hockey", ["20241109", "20251108", "20261107"]],
  ["lacrosse", "mens-college-lacrosse", ["20250405", "20260404"]],
  ["baseball", "college-baseball", ["20250419"]],
  ["soccer", "eng.1", ["20260314", "20260502"]],
  ["soccer", "usa.1", ["20260321", "20261017"]],
];
for (const [sport, league, dates] of CASES) {
  for (const d of dates) {
    const q = "";
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${d}${q}&limit=300`);
    const evs = (sb.events ?? []).filter((e) => e.status?.type?.completed).slice(0, 2);
    const out = [];
    for (const e of evs) {
      const comp = e.competitions?.[0]?.id ?? e.id;
      const core = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${league}/events/${e.id}/competitions/${comp}/odds`;
      const odds = await get(core);
      const parts = [];
      for (const it of odds.items ?? []) {
        const pid = String(it?.provider?.id ?? /\/odds\/(\d+)/.exec(it?.$ref ?? "")?.[1] ?? "");
        const full = it.provider ? it : await get(it.$ref);
        const hasOpen = !!(full.open || full.homeTeamOdds?.open || full.awayTeamOdds?.open);
        const pb = await get(`${core}/${pid}/propBets?limit=1000`);
        const types = {};
        for (const p of pb.items ?? []) types[p.type?.name ?? "?"] = (types[p.type?.name ?? "?"] ?? 0) + 1;
        parts.push(`${pid}${full.provider?.name ? "(" + full.provider.name + ")" : ""} line=${full.details ?? full.overUnder ?? "-"} open=${hasOpen ? "y" : "n"} props=${pb.count ?? pb.status} ${JSON.stringify(types).slice(0, 160)}`);
      }
      out.push(`${e.id}{${parts.join(" | ") || "no odds (" + (odds.count ?? odds.status) + ")"}}`);
    }
    console.log(`CASE ${league} ${d} games=${(sb.events ?? []).length} ${out.join(" ")}`);
  }
}
