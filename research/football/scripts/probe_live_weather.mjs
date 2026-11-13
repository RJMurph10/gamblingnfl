const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return [r.status, await r.text()]; } catch (e) { return ["ERR " + e, ""]; } };
for (const id of ["112", "77", "148"]) {
  const [s, t] = await get(`https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams/${id}`);
  const j = JSON.parse(t || "{}");
  console.log(id, s, "keys:", Object.keys(j.team ?? {}).join(","));
  console.log(" venue:", JSON.stringify(j.team?.venue ?? j.team?.franchise?.venue ?? null).slice(0, 400));
  console.log(" location:", j.team?.location, "| standingSummary:", j.team?.standingSummary);
}
const [s2, t2] = await get("https://sports.core.api.espn.com/v2/sports/baseball/leagues/college-baseball/teams/112?lang=en");
console.log("core", s2, t2.slice(0, 1200));
const [s3, t3] = await get("https://geocoding-api.open-meteo.com/v1/search?name=Norman&count=5&countryCode=US");
console.log("geo", s3, t3.slice(0, 600));
const [s4, t4] = await get("https://archive-api.open-meteo.com/v1/archive?latitude=35.22&longitude=-97.44&start_date=2025-03-01&end_date=2025-03-02&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FChicago");
console.log("archive", s4, t4.slice(0, 600));
