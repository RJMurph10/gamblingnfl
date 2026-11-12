// Temporary: NCAA.com scoreboard feed for D-I baseball: completeness and fields.
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json" };
const raw = async (u) => { try { const r = await fetch(u, { headers: H }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: "err", text: String(e) }; } };
for (const u of ["https://data.ncaa.com/robots.txt", "https://www.ncaa.com/robots.txt"]) {
  const r = await raw(u); console.log("ROBOTS", u, r.status, r.text.replace(/\n/g, " | ").slice(0, 800));
}
for (const d of ["2025/04/18", "2024/03/15", "2019/04/12"]) {
  const r = await raw(`https://data.ncaa.com/casablanca/scoreboard/baseball/d1/${d}/scoreboard.json`);
  let j = null; try { j = JSON.parse(r.text); } catch {}
  const games = j?.games ?? [];
  console.log("NCAA", d, r.status, "games", games.length, JSON.stringify(games[0]?.game ?? null).slice(0, 700));
  const fin = games.filter((g) => /final/i.test(g.game?.gameState ?? ""));
  console.log("  final", fin.length);
}
