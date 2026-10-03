/**
 * Sample team reference data for the visual prototype.
 *
 * Team identity (abbr/name/colors/division) is reference data, not statistics.
 * The `record` / `pointsFor` / `pointsAgainst` fields are PLACEHOLDER values
 * and are clearly labelled as sample data in the UI. Replace by reading the
 * `teams` + `team_season_stats` tables once real data is imported.
 */

export type Conference = "AFC" | "NFC";
export type DivisionName = "East" | "North" | "South" | "West";

export interface Team {
  id: string; // slug used in URLs, matches teams.slug in SQL
  abbr: string;
  city: string;
  name: string;
  conference: Conference;
  division: DivisionName;
  /** Primary brand color, used as a data-driven accent on team marks. */
  color: string;
  /** PLACEHOLDER record for layout purposes. */
  record: { w: number; l: number; t: number };
  /** PLACEHOLDER season aggregates. */
  pointsFor: number;
  pointsAgainst: number;
}

export const teams: Team[] = [
  { id: "bills", abbr: "BUF", city: "Buffalo", name: "Bills", conference: "AFC", division: "East", color: "#00338D", record: { w: 7, l: 2, t: 0 }, pointsFor: 231, pointsAgainst: 178 },
  { id: "dolphins", abbr: "MIA", city: "Miami", name: "Dolphins", conference: "AFC", division: "East", color: "#008E97", record: { w: 4, l: 5, t: 0 }, pointsFor: 196, pointsAgainst: 205 },
  { id: "patriots", abbr: "NE", city: "New England", name: "Patriots", conference: "AFC", division: "East", color: "#002244", record: { w: 3, l: 6, t: 0 }, pointsFor: 161, pointsAgainst: 212 },
  { id: "jets", abbr: "NYJ", city: "New York", name: "Jets", conference: "AFC", division: "East", color: "#125740", record: { w: 3, l: 6, t: 0 }, pointsFor: 154, pointsAgainst: 201 },

  { id: "ravens", abbr: "BAL", city: "Baltimore", name: "Ravens", conference: "AFC", division: "North", color: "#241773", record: { w: 8, l: 1, t: 0 }, pointsFor: 258, pointsAgainst: 171 },
  { id: "bengals", abbr: "CIN", city: "Cincinnati", name: "Bengals", conference: "AFC", division: "North", color: "#FB4F14", record: { w: 5, l: 4, t: 0 }, pointsFor: 212, pointsAgainst: 199 },
  { id: "browns", abbr: "CLE", city: "Cleveland", name: "Browns", conference: "AFC", division: "North", color: "#311D00", record: { w: 3, l: 6, t: 0 }, pointsFor: 158, pointsAgainst: 206 },
  { id: "steelers", abbr: "PIT", city: "Pittsburgh", name: "Steelers", conference: "AFC", division: "North", color: "#FFB612", record: { w: 6, l: 3, t: 0 }, pointsFor: 191, pointsAgainst: 174 },

  { id: "texans", abbr: "HOU", city: "Houston", name: "Texans", conference: "AFC", division: "South", color: "#03202F", record: { w: 6, l: 3, t: 0 }, pointsFor: 203, pointsAgainst: 181 },
  { id: "colts", abbr: "IND", city: "Indianapolis", name: "Colts", conference: "AFC", division: "South", color: "#002C5F", record: { w: 4, l: 5, t: 0 }, pointsFor: 188, pointsAgainst: 202 },
  { id: "jaguars", abbr: "JAX", city: "Jacksonville", name: "Jaguars", conference: "AFC", division: "South", color: "#006778", record: { w: 3, l: 6, t: 0 }, pointsFor: 171, pointsAgainst: 219 },
  { id: "titans", abbr: "TEN", city: "Tennessee", name: "Titans", conference: "AFC", division: "South", color: "#4B92DB", record: { w: 2, l: 7, t: 0 }, pointsFor: 142, pointsAgainst: 221 },

  { id: "broncos", abbr: "DEN", city: "Denver", name: "Broncos", conference: "AFC", division: "West", color: "#FB4F14", record: { w: 5, l: 4, t: 0 }, pointsFor: 184, pointsAgainst: 179 },
  { id: "chiefs", abbr: "KC", city: "Kansas City", name: "Chiefs", conference: "AFC", division: "West", color: "#E31837", record: { w: 7, l: 2, t: 0 }, pointsFor: 226, pointsAgainst: 172 },
  { id: "raiders", abbr: "LV", city: "Las Vegas", name: "Raiders", conference: "AFC", division: "West", color: "#A5ACAF", record: { w: 2, l: 7, t: 0 }, pointsFor: 139, pointsAgainst: 228 },
  { id: "chargers", abbr: "LAC", city: "Los Angeles", name: "Chargers", conference: "AFC", division: "West", color: "#0080C6", record: { w: 5, l: 4, t: 0 }, pointsFor: 186, pointsAgainst: 177 },

  { id: "cowboys", abbr: "DAL", city: "Dallas", name: "Cowboys", conference: "NFC", division: "East", color: "#041E42", record: { w: 4, l: 5, t: 0 }, pointsFor: 197, pointsAgainst: 208 },
  { id: "giants", abbr: "NYG", city: "New York", name: "Giants", conference: "NFC", division: "East", color: "#0B2265", record: { w: 2, l: 7, t: 0 }, pointsFor: 144, pointsAgainst: 224 },
  { id: "eagles", abbr: "PHI", city: "Philadelphia", name: "Eagles", conference: "NFC", division: "East", color: "#004C54", record: { w: 7, l: 2, t: 0 }, pointsFor: 219, pointsAgainst: 170 },
  { id: "commanders", abbr: "WAS", city: "Washington", name: "Commanders", conference: "NFC", division: "East", color: "#5A1414", record: { w: 5, l: 4, t: 0 }, pointsFor: 201, pointsAgainst: 196 },

  { id: "bears", abbr: "CHI", city: "Chicago", name: "Bears", conference: "NFC", division: "North", color: "#0B162A", record: { w: 5, l: 4, t: 0 }, pointsFor: 178, pointsAgainst: 181 },
  { id: "lions", abbr: "DET", city: "Detroit", name: "Lions", conference: "NFC", division: "North", color: "#0076B6", record: { w: 7, l: 2, t: 0 }, pointsFor: 248, pointsAgainst: 184 },
  { id: "packers", abbr: "GB", city: "Green Bay", name: "Packers", conference: "NFC", division: "North", color: "#203731", record: { w: 6, l: 3, t: 0 }, pointsFor: 211, pointsAgainst: 183 },
  { id: "vikings", abbr: "MIN", city: "Minnesota", name: "Vikings", conference: "NFC", division: "North", color: "#4F2683", record: { w: 6, l: 3, t: 0 }, pointsFor: 204, pointsAgainst: 188 },

  { id: "falcons", abbr: "ATL", city: "Atlanta", name: "Falcons", conference: "NFC", division: "South", color: "#A71930", record: { w: 5, l: 4, t: 0 }, pointsFor: 192, pointsAgainst: 194 },
  { id: "panthers", abbr: "CAR", city: "Carolina", name: "Panthers", conference: "NFC", division: "South", color: "#0085CA", record: { w: 2, l: 7, t: 0 }, pointsFor: 136, pointsAgainst: 231 },
  { id: "saints", abbr: "NO", city: "New Orleans", name: "Saints", conference: "NFC", division: "South", color: "#D3BC8D", record: { w: 3, l: 6, t: 0 }, pointsFor: 166, pointsAgainst: 209 },
  { id: "buccaneers", abbr: "TB", city: "Tampa Bay", name: "Buccaneers", conference: "NFC", division: "South", color: "#D50A0A", record: { w: 4, l: 5, t: 0 }, pointsFor: 189, pointsAgainst: 198 },

  { id: "cardinals", abbr: "ARI", city: "Arizona", name: "Cardinals", conference: "NFC", division: "West", color: "#97233F", record: { w: 4, l: 5, t: 0 }, pointsFor: 181, pointsAgainst: 195 },
  { id: "rams", abbr: "LAR", city: "Los Angeles", name: "Rams", conference: "NFC", division: "West", color: "#003594", record: { w: 5, l: 4, t: 0 }, pointsFor: 198, pointsAgainst: 190 },
  { id: "49ers", abbr: "SF", city: "San Francisco", name: "49ers", conference: "NFC", division: "West", color: "#AA0000", record: { w: 6, l: 3, t: 0 }, pointsFor: 216, pointsAgainst: 179 },
  { id: "seahawks", abbr: "SEA", city: "Seattle", name: "Seahawks", conference: "NFC", division: "West", color: "#002244", record: { w: 5, l: 4, t: 0 }, pointsFor: 193, pointsAgainst: 186 },
];

export const teamById = (id: string): Team | undefined => teams.find((t) => t.id === id);

export const teamByAbbr = (abbr: string): Team | undefined =>
  teams.find((t) => t.abbr.toLowerCase() === abbr.toLowerCase());

export const divisions: { conference: Conference; division: DivisionName }[] = [
  { conference: "AFC", division: "East" },
  { conference: "AFC", division: "North" },
  { conference: "AFC", division: "South" },
  { conference: "AFC", division: "West" },
  { conference: "NFC", division: "East" },
  { conference: "NFC", division: "North" },
  { conference: "NFC", division: "South" },
  { conference: "NFC", division: "West" },
];
