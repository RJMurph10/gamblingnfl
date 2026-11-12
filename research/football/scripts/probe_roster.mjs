// Temporary: does ESPN keep ESPN BET odds for PLL games anywhere (e.g. Outlaws vs Atlas, Aug 2025)?
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json", Referer: "https://www.espn.com/" };
const get = async (u) => { try { const r = await fetch(u, { headers: H }); return r.ok ? r.json() : { status: r.status }; } catch (e) { return { err: String(e) }; } };
const games = [];
for (let t = Date.UTC(2025, 5, 1); t <= Date.UTC(2025, 8, 30); t += 7 * 86400000) {
  const a = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const b = new Date(t + 6 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard?dates=${a}-${b}`);
  for (const e of sb.events ?? []) games.push(e);
}
console.log("PLL 2025 games", games.length);
const pick = games.filter((e) => /outlaws/i.test(e.name) && /atlas/i.test(e.name));
console.log("Outlaws-Atlas:", pick.map((e) => `${e.id} ${e.date} ${e.name}`).join(" | "));
const scoreboardOdds = games.filter((e) => e.competitions?.[0]?.odds?.length).length;
console.log("scoreboard events with odds:", scoreboardOdds);
for (const e of [...pick, ...games.slice(-2)]) {
  const core = `https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/pll/events/${e.id}/competitions/${e.id}`;
  const comp = await get(core);
  const odds = await get(`${core}/odds`);
  const p58 = await get(`${core}/odds/58`);
  const pb58 = await get(`${core}/odds/58/propBets?limit=1000`);
  const s = await get(`https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/summary?event=${e.id}`);
  console.log("GAME", e.id, e.name, "| comp keys:", Object.keys(comp).join(","), "| odds:", odds.count ?? odds.status, "| odds/58:", p58.status ?? JSON.stringify(p58).slice(0, 200), "| propBets58:", pb58.count ?? pb58.status);
  console.log("  summary keys:", Object.keys(s).join(","), "| pickcenter:", JSON.stringify(s.pickcenter ?? null).slice(0, 300), "| odds:", JSON.stringify(s.odds ?? null).slice(0, 200));
  console.log("  scoreboard odds:", JSON.stringify(e.competitions?.[0]?.odds ?? null).slice(0, 300));
}
