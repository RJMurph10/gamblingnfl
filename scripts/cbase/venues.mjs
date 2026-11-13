/**
 * Home locations for ESPN's college baseball teams: city/state from ESPN's men's college basketball
 * (else football) team record, looked up by the universal id in the team's logo URL, then latitude,
 * longitude, elevation and time zone from Open-Meteo's geocoder.
 *
 *   node scripts/cbase/venues.mjs <espn-teams.json> <out.json>
 */
import { readFile, writeFile } from "node:fs/promises";

const STATES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",PR:"Puerto Rico"};
const get = async (u) => {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400) return null;
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 1000 * (t + 1)));
  }
  return null;
};
const teams = JSON.parse(await readFile(process.argv[2], "utf8"));
const out = {};
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < teams.length) {
      const t = teams[next++];
      const uni = t.logo?.match(/\/(\d+)\.png/)?.[1];
      if (!uni) continue;
      let addr = null;
      for (const lg of ["basketball/leagues/mens-college-basketball", "football/leagues/college-football"]) {
        const j = await get(`https://sports.core.api.espn.com/v2/sports/${lg}/teams/${uni}?lang=en`);
        if (j?.venue?.address?.city) {
          addr = j.venue.address;
          break;
        }
      }
      if (!addr) continue;
      const state = STATES[addr.state] ?? addr.state;
      const g = await get(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(addr.city)}&count=10&countryCode=US`,
      );
      const hit = (g?.results ?? []).find((x) => x.admin1 === state) ?? null;
      out[t.id] = {
        uni,
        name: t.display,
        city: addr.city,
        state: addr.state,
        lat: hit?.latitude ?? null,
        lon: hit?.longitude ?? null,
        elev: hit?.elevation ?? null,
        tz: hit?.timezone ?? null,
      };
    }
  }),
);
await writeFile(process.argv[3], JSON.stringify(out));
const vals = Object.values(out);
console.log(`venues: ${vals.length} of ${teams.length} teams, ${vals.filter((v) => v.lat != null).length} geocoded`);
console.log("not geocoded:", vals.filter((v) => v.lat == null).map((v) => `${v.name} (${v.city}, ${v.state})`).join("; "));
