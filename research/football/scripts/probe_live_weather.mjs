// Temporary: what ESPN and NWS say about weather for a live game.
const id = process.argv[2];
const UA = { "User-Agent": "GamblingNFL/1.0 https://gamblingnfl.lovable.app/", Accept: "application/geo+json" };
const j = async (u, h = {}) => { try { const r = await fetch(u, { headers: h }); return r.ok ? r.json() : `HTTP ${r.status}`; } catch (e) { return String(e); } };
const s = await j(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`);
console.log("ESPN status:", s?.header?.competitions?.[0]?.status?.type?.detail);
console.log("ESPN gameInfo.weather:", JSON.stringify(s?.gameInfo?.weather, null, 1));
const p = await j("https://api.weather.gov/points/40.8135,-74.0745", UA);
const h = await j(p?.properties?.forecastHourly, UA);
console.log("NWS hourly (next 6):");
for (const x of (h?.properties?.periods ?? []).slice(0, 6))
  console.log(x.startTime, x.temperature, x.shortForecast, "| wind", x.windSpeed, x.windDirection, "| pop", x.probabilityOfPrecipitation?.value);
for (const st of ["KTEB", "KEWR"]) {
  const o = await j(`https://api.weather.gov/stations/${st}/observations/latest`, UA);
  const q = o?.properties;
  console.log(st, q?.timestamp, q?.textDescription, "| wind km/h", q?.windSpeed?.value, "gust", q?.windGust?.value, "| precip last hr mm", q?.precipitationLastHour?.value);
}
