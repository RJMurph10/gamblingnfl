// Temporary: where are 2026 NCAA baseball scores?
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124", Accept: "application/json" };
const raw = async (u) => { try { const r = await fetch(u, { headers: H }); const t = await r.text(); return `${r.status} ${t.slice(0, 400).replace(/\n/g, " ")}`; } catch (e) { return "err " + e; } };
for (const u of [
  "https://data.ncaa.com/casablanca/scoreboard/baseball/d1/2026/04/17/scoreboard.json",
  "https://data.ncaa.com/casablanca/scoreboard/baseball/d1/2026/04/18/scoreboard.json",
  "https://data.ncaa.com/casablanca/scoreboard/baseball/d1/2025/06/20/scoreboard.json",
  "https://data.ncaa.com/casablanca/schedule/baseball/d1/2026/04/schedule.json",
  "https://data.ncaa.com/casablanca/schedule/baseball/d1/2025/04/schedule.json",
  "https://www.ncaa.com/scoreboard/baseball/d1/2026/04/18/all-conf",
  "https://sdataprod.ncaa.com/?meta=GetContests_web&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%227287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c%22%7D%7D&variables=%7B%22sportCode%22%3A%22MBA%22%2C%22division%22%3A1%2C%22seasonYear%22%3A2025%2C%22contestDate%22%3A%2204%2F18%2F2026%22%2C%22week%22%3Anull%7D",
]) console.log("URL", u.slice(0, 110), "=>", await raw(u));
