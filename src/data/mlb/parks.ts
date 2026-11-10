/**
 * Each MLB team's home park (2026): coordinates for the weather forecast, the direction from home plate
 * to center field (degrees clockwise from north) to tell wind blowing out from in or across, and the roof.
 * Source: SportsDataverse mlb_park_dimensions (azimuth_deg: "home plate to centre field line, Fenway 45").
 * Keyed by ESPN team abbreviation. The Athletics play at Sutter Health Park (Sacramento) 2025-2027.
 */
export interface MlbPark {
  name: string;
  lat: number;
  lon: number;
  /** Home plate → center field, degrees clockwise from north. */
  azimuth: number;
  /** Retractable roofs are treated as closed (no weather adjustment): their status isn't known ahead. */
  roof: "open" | "retractable" | "dome";
}

export const MLB_PARKS: Record<string, MlbPark> = {
  ARI: { name: "Chase Field", lat: 33.4453, lon: -112.0667, azimuth: 0, roof: "retractable" },
  ATH: { name: "Sutter Health Park", lat: 38.5799, lon: -121.5125, azimuth: 46, roof: "open" },
  ATL: { name: "Truist Park", lat: 33.8907, lon: -84.4676, azimuth: 145, roof: "open" },
  BAL: {
    name: "Oriole Park at Camden Yards",
    lat: 39.2838,
    lon: -76.6217,
    azimuth: 31,
    roof: "open",
  },
  BOS: { name: "Fenway Park", lat: 42.3465, lon: -71.0974, azimuth: 45, roof: "open" },
  CHC: { name: "Wrigley Field", lat: 41.9482, lon: -87.6555, azimuth: 37, roof: "open" },
  CHW: { name: "Rate Field", lat: 41.83, lon: -87.6342, azimuth: 127, roof: "open" },
  CIN: {
    name: "Great American Ball Park",
    lat: 39.0974,
    lon: -84.5066,
    azimuth: 122,
    roof: "open",
  },
  CLE: { name: "Progressive Field", lat: 41.4959, lon: -81.6853, azimuth: 0, roof: "open" },
  COL: { name: "Coors Field", lat: 39.756, lon: -104.9941, azimuth: 4, roof: "open" },
  DET: { name: "Comerica Park", lat: 42.3391, lon: -83.0487, azimuth: 150, roof: "open" },
  HOU: { name: "Daikin Park", lat: 29.757, lon: -95.3555, azimuth: 343, roof: "retractable" },
  KC: { name: "Kauffman Stadium", lat: 39.0516, lon: -94.4805, azimuth: 46, roof: "open" },
  LAA: { name: "Angel Stadium", lat: 33.8002, lon: -117.8824, azimuth: 43.61, roof: "open" },
  LAD: {
    name: "UNIQLO Field at Dodger Stadium",
    lat: 34.0737,
    lon: -118.2405,
    azimuth: 26,
    roof: "open",
  },
  MIA: { name: "loanDepot park", lat: 25.778, lon: -80.2195, azimuth: 128, roof: "retractable" },
  MIL: {
    name: "American Family Field",
    lat: 43.0284,
    lon: -87.971,
    azimuth: 129,
    roof: "retractable",
  },
  MIN: { name: "Target Field", lat: 44.9818, lon: -93.2779, azimuth: 129, roof: "open" },
  NYM: { name: "Citi Field", lat: 40.7575, lon: -73.8456, azimuth: 13, roof: "open" },
  NYY: { name: "Yankee Stadium", lat: 40.8292, lon: -73.9265, azimuth: 75, roof: "open" },
  PHI: { name: "Citizens Bank Park", lat: 39.9054, lon: -75.1672, azimuth: 9, roof: "open" },
  PIT: { name: "PNC Park", lat: 40.4469, lon: -80.0058, azimuth: 116, roof: "open" },
  SD: { name: "Petco Park", lat: 32.7079, lon: -117.1573, azimuth: 0, roof: "open" },
  SEA: { name: "T-Mobile Park", lat: 47.5913, lon: -122.3325, azimuth: 49, roof: "retractable" },
  SF: { name: "Oracle Park", lat: 37.7784, lon: -122.3894, azimuth: 85, roof: "open" },
  STL: { name: "Busch Stadium", lat: 38.6226, lon: -90.1929, azimuth: 62, roof: "open" },
  TB: { name: "Tropicana Field", lat: 27.7678, lon: -82.6525, azimuth: 359, roof: "dome" },
  TEX: { name: "Globe Life Field", lat: 32.7473, lon: -97.0818, azimuth: 30, roof: "retractable" },
  TOR: { name: "Rogers Centre", lat: 43.6416, lon: -79.3892, azimuth: 345, roof: "retractable" },
  WSH: { name: "Nationals Park", lat: 38.8729, lon: -77.0075, azimuth: 28, roof: "open" },
};
