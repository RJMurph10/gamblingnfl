// Temporary: where do college baseball box scores (starting pitchers) live?
const H = { "User-Agent": "Mozilla/5.0 (gamblingnfl research)", Accept: "application/json" };
const get = async (u, json = true) => {
  try {
    const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    return { status: r.status, body: json ? (() => { try { return JSON.parse(t); } catch { return t.slice(0, 300); } })() : t };
  } catch (e) { return { status: "ERR " + e }; }
};
const show = (label, x) => console.log(`\n== ${label}: ${x.status}\n` + (typeof x.body === "string" ? x.body.slice(0, 1500) : JSON.stringify(x.body).slice(0, 2500)));

// 2025 game via casablanca
const sb = await get("https://data.ncaa.com/casablanca/scoreboard/baseball/d1/2025/05/10/scoreboard.json");
const g25 = sb.body?.games?.[0]?.game;
console.log("2025 game", g25?.gameID, g25?.url, g25?.away?.names?.short, "@", g25?.home?.names?.short);
for (const f of ["boxscore.json", "gameInfo.json", "pbp.json", "teamStats.json"])
  show(`casablanca 2025 ${f}`, await get(`https://data.ncaa.com/casablanca/game/${g25?.gameID}/${f}`));

// 2026 via GraphQL contests
const HASH = "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c";
const u = `https://sdataprod.ncaa.com/?meta=GetContests_web&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASH } }))}&variables=${encodeURIComponent(JSON.stringify({ sportCode: "MBA", division: 1, seasonYear: 2025, contestDate: "05/09/2026", week: null }))}`;
const q = await get(u);
const c = q.body?.data?.contests?.[0];
console.log("\n2026 contest keys", Object.keys(c ?? {}).join(","), "\n", JSON.stringify(c).slice(0, 800));
const id26 = c?.contestId;
for (const f of ["boxscore.json", "gameInfo.json"])
  show(`casablanca 2026 ${f}`, await get(`https://data.ncaa.com/casablanca/game/${id26}/${f}`));

// game page html → find GraphQL operation names / hashes
const page = await get(`https://www.ncaa.com${c?.url ?? `/game/${id26}`}/boxscore`, false);
console.log("\npage", page.status, typeof page.body === "string" ? page.body.length : 0);
const html = typeof page.body === "string" ? page.body : "";
const ops = new Set([...html.matchAll(/meta=([A-Za-z_]+)/g)].map((m) => m[1]));
console.log("ops in html:", [...ops].join(", "));
const hashes = [...html.matchAll(/sha256Hash[\\"]*:[\\"]*([0-9a-f]{64})/g)].map((m) => m[1]);
console.log("hashes:", [...new Set(hashes)].join(" "));
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 40);
console.log("scripts:", scripts.join("\n"));
for (const s of scripts.filter((s) => /gamecenter|game|boxscore|main|app/i.test(s)).slice(0, 12)) {
  const js = await get(s.startsWith("http") ? s : `https://www.ncaa.com${s}`, false);
  const t = typeof js.body === "string" ? js.body : "";
  const found = [...t.matchAll(/(Get[A-Za-z_]*(?:Box|Score|Stat|Gamecenter|Game)[A-Za-z_]*)/g)].map((m) => m[1]);
  const hs = [...t.matchAll(/([0-9a-f]{64})/g)].map((m) => m[1]);
  if (found.length || hs.length) console.log("\n", s, [...new Set(found)].slice(0, 30).join(","), [...new Set(hs)].slice(0, 20).join(" "));
}
