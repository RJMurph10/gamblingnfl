const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return [r.status, await r.text()]; } catch (e) { return ["ERR " + e, ""]; } };
for (const lg of ["basketball/leagues/mens-college-basketball", "football/leagues/college-football"])
  for (const id of ["201", "2934", "2115"]) {
    const [s, t] = await get(`https://sports.core.api.espn.com/v2/sports/${lg}/teams/${id}?lang=en`);
    let j = {}; try { j = JSON.parse(t); } catch {}
    console.log("CORE", lg.split("/")[2], id, s, j.displayName, "venue:", String(JSON.stringify(j.venue?.address ?? j.venue ?? null)).slice(0, 300));
  }
