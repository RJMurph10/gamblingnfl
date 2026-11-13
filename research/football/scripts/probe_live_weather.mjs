const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return [r.status, await r.text()]; } catch (e) { return ["ERR " + e, ""]; } };
const [s, t] = await get("https://sports.core.api.espn.com/v2/sports/baseball/leagues/college-baseball/teams/112?lang=en");
const j = JSON.parse(t); console.log("core keys", Object.keys(j).join(","), "venue", String(JSON.stringify(j.venue)).slice(0, 600));
for (const id of ["201", "59", "333"]) {
  const [s2, t2] = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${id}`);
  const k = JSON.parse(t2 || "{}");
  console.log("mbb", id, s2, JSON.stringify(k.team?.franchise?.venue?.address ?? k.team?.venue ?? null));
}
