const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json" };
const url = (d, y) => `https://sdataprod.ncaa.com/?meta=GetContests_web&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c" } }))}&variables=${encodeURIComponent(JSON.stringify({ sportCode: "MBA", division: 1, seasonYear: y, contestDate: d, week: null }))}`;
for (const [d, y] of [["04/18/2026", 2025], ["04/18/2026", 2026], ["06/20/2025", 2024], ["06/20/2025", 2025]]) {
  const r = await fetch(url(d, y), { headers: H });
  const j = await r.json().catch(() => null);
  const c = j?.data?.contests ?? [];
  console.log("DAY", d, "seasonYear", y, r.status, "contests", c.length, "final", c.filter((x) => x.gameState === "F").length);
  if (c[0] && d === "04/18/2026" && y === 2025) console.log("ONE", JSON.stringify(c[0]).slice(0, 2500));
}
