/**
 * NFL stadium coordinates, timezones, and indoor/dome classifications.
 *
 * Indoor stadiums (fixed domes, retractable roofs, and climate-controlled canopies)
 * display the required static "Climate Controlled" card and skip outdoor API calls.
 */
 
import { teamById } from "@/data/teams";
 
export interface StadiumInfo {
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  timezone: string;
  /** True for fixed domes, retractable roofs, and covered canopies. */
  isIndoor: boolean;
  /** True for games played outside the U.S. (weather comes from a European/global source). */
  international?: boolean;
}
 
export const NFL_STADIUMS: Record<string, StadiumInfo> = {
  // AFC East
  BUF: { name: "Highmark Stadium", city: "Orchard Park", state: "NY", lat: 42.7738, lon: -78.7870, timezone: "America/New_York", isIndoor: false },
  MIA: { name: "Hard Rock Stadium", city: "Miami Gardens", state: "FL", lat: 25.9580, lon: -80.2389, timezone: "America/New_York", isIndoor: false },
  NE:  { name: "Gillette Stadium", city: "Foxborough", state: "MA", lat: 42.0909, lon: -71.2643, timezone: "America/New_York", isIndoor: false },
  NYJ: { name: "MetLife Stadium", city: "East Rutherford", state: "NJ", lat: 40.8135, lon: -74.0745, timezone: "America/New_York", isIndoor: false },
 
  // AFC North
  BAL: { name: "M&T Bank Stadium", city: "Baltimore", state: "MD", lat: 39.2780, lon: -76.6227, timezone: "America/New_York", isIndoor: false },
  CIN: { name: "Paycor Stadium", city: "Cincinnati", state: "OH", lat: 39.0955, lon: -84.5161, timezone: "America/New_York", isIndoor: false },
  CLE: { name: "Huntington Bank Field", city: "Cleveland", state: "OH", lat: 41.5061, lon: -81.6995, timezone: "America/New_York", isIndoor: false },
  PIT: { name: "Acrisure Stadium", city: "Pittsburgh", state: "PA", lat: 40.4468, lon: -80.0158, timezone: "America/New_York", isIndoor: false },
 
  // AFC South
  HOU: { name: "NRG Stadium", city: "Houston", state: "TX", lat: 29.6847, lon: -95.4107, timezone: "America/Chicago", isIndoor: true },
  IND: { name: "Lucas Oil Stadium", city: "Indianapolis", state: "IN", lat: 39.7601, lon: -86.1639, timezone: "America/Indiana/Indianapolis", isIndoor: true },
  JAX: { name: "EverBank Stadium", city: "Jacksonville", state: "FL", lat: 30.3239, lon: -81.6373, timezone: "America/New_York", isIndoor: false },
  TEN: { name: "Nissan Stadium", city: "Nashville", state: "TN", lat: 36.1665, lon: -86.7713, timezone: "America/Chicago", isIndoor: false },
 
  // AFC West
  DEN: { name: "Empower Field at Mile High", city: "Denver", state: "CO", lat: 39.7439, lon: -105.0201, timezone: "America/Denver", isIndoor: false },
  KC:  { name: "GEHA Field at Arrowhead Stadium", city: "Kansas City", state: "MO", lat: 39.0489, lon: -94.4839, timezone: "America/Chicago", isIndoor: false },
  LV:  { name: "Allegiant Stadium", city: "Las Vegas", state: "NV", lat: 36.0909, lon: -115.1833, timezone: "America/Los_Angeles", isIndoor: true },
  LAC: { name: "SoFi Stadium", city: "Inglewood", state: "CA", lat: 33.9535, lon: -118.3390, timezone: "America/Los_Angeles", isIndoor: true },
 
  // NFC East
  DAL: { name: "AT&T Stadium", city: "Arlington", state: "TX", lat: 32.7473, lon: -97.0945, timezone: "America/Chicago", isIndoor: true },
  NYG: { name: "MetLife Stadium", city: "East Rutherford", state: "NJ", lat: 40.8135, lon: -74.0745, timezone: "America/New_York", isIndoor: false },
  PHI: { name: "Lincoln Financial Field", city: "Philadelphia", state: "PA", lat: 39.9008, lon: -75.1675, timezone: "America/New_York", isIndoor: false },
  WSH: { name: "Northwest Stadium", city: "Landover", state: "MD", lat: 38.9076, lon: -76.8645, timezone: "America/New_York", isIndoor: false },
 
  // NFC North
  CHI: { name: "Soldier Field", city: "Chicago", state: "IL", lat: 41.8623, lon: -87.6167, timezone: "America/Chicago", isIndoor: false },
  DET: { name: "Ford Field", city: "Detroit", state: "MI", lat: 42.3400, lon: -83.0456, timezone: "America/Detroit", isIndoor: true },
  GB:  { name: "Lambeau Field", city: "Green Bay", state: "WI", lat: 44.5013, lon: -88.0622, timezone: "America/Chicago", isIndoor: false },
  MIN: { name: "U.S. Bank Stadium", city: "Minneapolis", state: "MN", lat: 44.9735, lon: -93.2575, timezone: "America/Chicago", isIndoor: true },
 
  // NFC South
  ATL: { name: "Mercedes-Benz Stadium", city: "Atlanta", state: "GA", lat: 33.7553, lon: -84.4006, timezone: "America/New_York", isIndoor: true },
  CAR: { name: "Bank of America Stadium", city: "Charlotte", state: "NC", lat: 35.2251, lon: -80.8528, timezone: "America/New_York", isIndoor: false },
  NO:  { name: "Caesars Superdome", city: "New Orleans", state: "LA", lat: 29.9511, lon: -90.0812, timezone: "America/Chicago", isIndoor: true },
  TB:  { name: "Raymond James Stadium", city: "Tampa", state: "FL", lat: 27.9759, lon: -82.5033, timezone: "America/New_York", isIndoor: false },
 
  // NFC West
  ARI: { name: "State Farm Stadium", city: "Glendale", state: "AZ", lat: 33.5276, lon: -112.2626, timezone: "America/Phoenix", isIndoor: true },
  LAR: { name: "SoFi Stadium", city: "Inglewood", state: "CA", lat: 33.9535, lon: -118.3390, timezone: "America/Los_Angeles", isIndoor: true },
  SF:  { name: "Levi's Stadium", city: "Santa Clara", state: "CA", lat: 37.4032, lon: -121.9698, timezone: "America/Los_Angeles", isIndoor: false },
  SEA: { name: "Lumen Field", city: "Seattle", state: "WA", lat: 47.5952, lon: -122.3316, timezone: "America/Los_Angeles", isIndoor: false },
 
  // International / neutral venues
  TOTTENHAM: { name: "Tottenham Hotspur Stadium", city: "London", state: "UK", lat: 51.6043, lon: -0.0664, timezone: "Europe/London", isIndoor: false, international: true },
  WEMBLEY:   { name: "Wembley Stadium", city: "London", state: "UK", lat: 51.5560, lon: -0.2795, timezone: "Europe/London", isIndoor: false, international: true },
  ALLIANZ:   { name: "Allianz Arena", city: "Munich", state: "Germany", lat: 48.2188, lon: 11.6247, timezone: "Europe/Berlin", isIndoor: false, international: true },
  SAOPAULO:  { name: "Corinthians Arena", city: "São Paulo", state: "Brazil", lat: -23.5453, lon: -46.4742, timezone: "America/Sao_Paulo", isIndoor: false, international: true },
  MELBOURNE: { name: "Melbourne Cricket Ground", city: "Melbourne", state: "Australia", lat: -37.8200, lon: 144.9834, timezone: "Australia/Melbourne", isIndoor: false, international: true },
  MARACANA:  { name: "Maracanã Stadium", city: "Rio de Janeiro", state: "Brazil", lat: -22.9122, lon: -43.2302, timezone: "America/Sao_Paulo", isIndoor: false, international: true },
  PARIS:     { name: "Stade de France", city: "Paris", state: "France", lat: 48.9245, lon: 2.3601, timezone: "Europe/Paris", isIndoor: false, international: true },
  MADRID:    { name: "Santiago Bernabéu", city: "Madrid", state: "Spain", lat: 40.4531, lon: -3.6883, timezone: "Europe/Madrid", isIndoor: false, international: true },
  BANORTE:   { name: "Estadio Banorte", city: "Mexico City", state: "Mexico", lat: 19.3029, lon: -99.1505, timezone: "America/Mexico_City", isIndoor: false, international: true },
};
 
/** Lowercase and strip accents so "Maracanã" matches "maracana". */
const normalize = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
 
// Venue-name keywords for the games played outside the U.S.
const INTERNATIONAL_KEYWORDS: [string, string[]][] = [
  ["TOTTENHAM", ["tottenham"]],
  ["WEMBLEY", ["wembley"]],
  ["ALLIANZ", ["allianz", "bayern", "munich"]],
  ["SAOPAULO", ["corinthians", "sao paulo"]],
  ["MELBOURNE", ["melbourne", "mcg"]],
  ["MARACANA", ["maracana", "rio de janeiro"]],
  ["PARIS", ["stade de france", "saint-denis", "paris"]],
  ["MADRID", ["bernabeu", "madrid"]],
  ["BANORTE", ["banorte", "azteca", "mexico city"]],
];
 
/**
 * Finds the stadium for a game. Order:
 *  1. international venues, by venue name;
 *  2. U.S. stadiums, by venue name;
 *  3. the home team's stadium (team ids are names like "falcons", so they are
 *     turned into abbreviations like "ATL" first).
 * Returns null when nothing matches, so the card says "Weather unavailable"
 * instead of showing some other stadium's weather.
 */
export function getStadiumForGame(homeTeamId: string, venueName?: string): StadiumInfo | null {
  const v = normalize(venueName ?? "");
 
  if (v) {
    for (const [key, words] of INTERNATIONAL_KEYWORDS) {
      if (words.some((w) => v.includes(w))) return NFL_STADIUMS[key];
    }
    for (const info of Object.values(NFL_STADIUMS)) {
      if (!info.international && v.includes(normalize(info.name))) return info;
    }
  }
 
  const abbr = teamById(homeTeamId)?.abbr ?? homeTeamId.toUpperCase();
  const home = NFL_STADIUMS[abbr];
  return home && !home.international ? home : null;
}
 
