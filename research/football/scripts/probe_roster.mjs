// Temporary: (1) college basketball propBets 500s: smaller pages? (2) which 2025-26 NBA/NHL/NFL days still have DraftKings props.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status, body: (await r.text()).slice(0, 150) }; } catch (e) { return { err: String(e) }; } };
const cb = (id) => `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${id}/competitions/${id}/odds`;
for (const id of ["401725667", "401638582"]) {
  for (const q of ["", "?limit=25", "?limit=100", "?limit=10&page=2", "?lang=en&region=us&limit=50"]) {
    const r = await get(`${cb(id)}/58/propBets${q}`);
    console.log("CBB", id, q || "(none)", r.count ?? r.status, r.pageCount ?? "", JSON.stringify(r.items?.[0] ?? r.body ?? r.err)?.slice(0, 300));
  }
  const o = await get(`${cb(id)}/58`);
  console.log("CBB odds58 keys", id, Object.keys(o).join(","), JSON.stringify(o.propBets ?? null));
}
// day scan, one game per day
const SP = { nba: "basketball/nba", nhl: "hockey/nhl", nfl: "football/nfl" };
for (const lg of ["nba", "nhl", "nfl"]) {
  const [s, l] = SP[lg].split("/");
  const line = [];
  for (let t = Date.UTC(2025, 10, 25); t <= Date.UTC(2026, 3, 10); t += 86400000 * 3) {
    const d = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/${s}/${l}/scoreboard?dates=${d}`);
    const e = (sb.events ?? []).find((x) => x.status?.type?.completed);
    if (!e) continue;
    const pb = await get(`https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}/events/${e.id}/competitions/${e.id}/odds/100/propBets?limit=1000`);
    line.push(`${d.slice(4)}:${pb.count ?? pb.status}`);
  }
  console.log("SCAN", lg, line.join(" "));
}
