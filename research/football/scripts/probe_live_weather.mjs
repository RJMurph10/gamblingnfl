const get = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); return [r.status, await r.text()]; } catch (e) { return ["ERR " + e, ""]; } };
let withProb = 0, total = 0, sample = null;
for (const d of ["20260509", "20260510", "20260417", "20260307", "20250502", "20240503"]) {
  const [s, t] = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?dates=${d}&limit=300`);
  const j = JSON.parse(t || "{}");
  let n = 0, p = 0;
  for (const e of j.events ?? []) {
    n++;
    const comps = e.competitions?.[0]?.competitors ?? [];
    if (comps.some((c) => c.probables?.length)) { p++; if (!sample) sample = comps.map((c) => c.probables); }
  }
  console.log("SB", d, s, "events", n, "with probables", p);
}
console.log("SAMPLE", JSON.stringify(sample).slice(0, 800));
// summary of one event
const [s2, t2] = await get("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?dates=20260509&limit=5");
const ev = JSON.parse(t2).events?.[0];
const [s3, t3] = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary?event=${ev.id}`);
const sm = JSON.parse(t3 || "{}");
console.log("SUMMARY keys", Object.keys(sm).join(","), "| header probables", JSON.stringify(sm.header?.competitions?.[0]?.competitors?.map((c) => c.probables)).slice(0, 400));
// NCAA gamecenter game query
const H = "26d14df5714c5cd454c9032a1f8ebb1b1dc35173065ab858709b0fa84dd07b5f";
const u = `https://sdataprod.ncaa.com/?meta=GetGamecenterGameById_web&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: H } }))}&variables=${encodeURIComponent(JSON.stringify({ id: "6584993", week: null, staticTestEnv: null }))}`;
const [s4, t4] = await get(u);
console.log("NCAA GAME", s4, t4.slice(0, 1500));
const [s5, t5] = await get("https://www.ncaa.com/game/6584993/preview");
console.log("PREVIEW", s5, (t5.match(/probable[^<]{0,200}/gi) || []).slice(0, 5));
