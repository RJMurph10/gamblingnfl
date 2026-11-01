// Runs the site's CFB schedule loader like a fresh server would, and reports what it returns.
let n = 0;
const real = globalThis.fetch;
const hosts: Record<string, number> = {};
globalThis.fetch = (async (input: any, init?: any) => {
  n++;
  const u = typeof input === "string" ? input : input.url;
  const k = u.replace(/\?.*/, "").replace(/\d{5,}/g, "#").slice(0, 110);
  hosts[k] = (hosts[k] ?? 0) + 1;
  return real(input, init);
}) as typeof fetch;
const { fetchCfbSchedule } = await import("../../src/lib/cfb/cfb-espn.server");
for (const run of [1, 2]) {
  const t = Date.now();
  n = 0;
  const games = await fetchCfbSchedule();
  const live = games.filter((g) => g.status === "live");
  const byWeek: Record<string, string> = {};
  for (const g of games) byWeek[g.week] = `${(byWeek[g.week] ?? "").length ? byWeek[g.week] : ""}`;
  console.log(`run ${run}: ${games.length} games, ${live.length} live, ${Date.now() - t} ms, ${n} fetches`);
  for (const g of live.slice(0, 10)) console.log("  LIVE", g.id, g.week, g.kickoffIso, g.clock, (g as any).awayAbbr ?? "", (g as any).homeAbbr ?? "");
  const recent = games.filter((g) => g.kickoffIso && Date.parse(g.kickoffIso) > Date.now() - 3 * 86400000 && Date.parse(g.kickoffIso) < Date.now());
  const st: Record<string, number> = {};
  for (const g of recent) st[g.status] = (st[g.status] ?? 0) + 1;
  console.log("  last 3 days by status", st);
}
console.log(Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 15));
