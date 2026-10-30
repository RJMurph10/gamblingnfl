/**
 * Browser-safe MLB types and helpers shared by the server adapter (mlb.server.ts), the model
 * (mlb-model.ts) and the /mlb pages. Nothing here touches the network.
 */

export type MlbStatus = "scheduled" | "live" | "final" | "postponed";
/** reg = regular season, post = postseason (spring training is left out). */
export type MlbSeasonPart = "reg" | "post";

export interface MlbTeamRef {
  id: string;
  abbr: string;
  /** Full name, e.g. "New York Yankees". */
  name: string;
  /** Nickname, e.g. "Yankees". */
  nickname: string;
  /** Brand color as #rrggbb. */
  color: string;
  logo: string;
}

/** Sportsbook lines as ESPN reports them; missing values stay null (nothing is estimated). */
export interface MlbOdds {
  /** Home run line: negative = home favorite (home -1.5 → -1.5). */
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  spreadOddsHome?: number | null;
  spreadOddsAway?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  open?: {
    spread?: number | null;
    total?: number | null;
    mlHome?: number | null;
    mlAway?: number | null;
  };
  provider?: string;
}

/** A probable (or actual) starting pitcher. */
export interface MlbPitcher {
  id: string;
  name: string;
  /** Season ERA and record when ESPN lists them. */
  era?: number | null;
  record?: string;
  throws?: string;
}

export interface MlbSide {
  team: MlbTeamRef;
  /** Runs. */
  score: number | null;
  hits?: number | null;
  errors?: number | null;
  record?: string;
  /** Runs per inning (extra innings continue the list). */
  innings?: (number | null)[];
  probable?: MlbPitcher;
}

/** The live game state ESPN reports between pitches. */
export interface MlbSituation {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  pitcher?: { id: string; name: string; summary?: string };
  batter?: { id: string; name: string; summary?: string };
  lastPlay?: string;
}

export interface MlbGame {
  id: string;
  /** ISO first-pitch time. */
  date: string;
  status: MlbStatus;
  statusDetail: string;
  /** Inning number; half is "top" / "bottom" (or "mid" / "end" between halves). */
  inning: number;
  half?: "top" | "bottom" | "mid" | "end";
  part: MlbSeasonPart;
  note?: string;
  venue?: string;
  broadcast?: string;
  weather?: string;
  away: MlbSide;
  home: MlbSide;
  odds?: MlbOdds;
  situation?: MlbSituation;
}

export interface MlbPlay {
  id: string;
  inning: number;
  half: "top" | "bottom";
  text: string;
  type: string;
  teamId?: string;
  awayScore: number | null;
  homeScore: number | null;
  scoring: boolean;
}

export interface MlbBoxGroup {
  /** "batting" or "pitching". */
  name: string;
  labels: string[];
  athletes: { id: string; name: string; position?: string; stats: string[] }[];
  totals?: string[];
}

export interface MlbGameDetail {
  game: MlbGame;
  plays: MlbPlay[];
  box: { teamId: string; groups: MlbBoxGroup[] }[];
  teamStats: { teamId: string; stats: { name: string; label: string; value: string }[] }[];
  injuries: { teamId: string; name: string; status: string; detail?: string }[];
}

/* ---------- formatting ---------- */

export const mlbLogoFor = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`;

export function localTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function americanText(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : String(n);
}

export function lineText(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined) return "—";
  return signed && n > 0 ? `+${n}` : String(n);
}

/** Implied probability of American odds (vig included). */
const impliedOf = (price: number) => (price < 0 ? -price / (-price + 100) : 100 / (price + 100));

/**
 * Run-line prices that make sense, or null.
 *
 * Prices that are clearly on the wrong teams get swapped back. The test uses the moneyline: the
 * favorite covers −1.5 about 15 points less often than it wins (2022–25 DraftKings/FanDuel), so
 * whichever assignment of the two prices lands closer to that is the right one. A swap needs a
 * clear margin, because near a 50% cover chance either way looks plausible (on clean 2022–25 lines
 * this swaps 0.03% of games and catches about two-thirds of deliberately swapped ones). Note a
 * heavy favorite's −1.5 often pays LESS than the dog's +1.5; that's normal, not a swap.
 * −110/−110 is a placeholder, not a real run-line price.
 */
export function runLinePrices(
  o:
    | Pick<MlbOdds, "spread" | "spreadOddsHome" | "spreadOddsAway" | "mlHome" | "mlAway">
    | null
    | undefined,
): { home: number; away: number } | null {
  const h = o?.spreadOddsHome;
  const a = o?.spreadOddsAway;
  if (!o || o.spread == null || o.spread === 0 || h == null || a == null) return null;
  if (h === -110 && a === -110) return null;
  if (o.mlHome == null || o.mlAway == null) return { home: h, away: a };
  const homeFav = o.spread < 0; // the run-line favorite (−1.5)
  const ph = impliedOf(o.mlHome);
  const pa = impliedOf(o.mlAway);
  const pFav = (homeFav ? ph : pa) / (ph + pa);
  const fav = homeFav ? h : a;
  const dog = homeFav ? a : h;
  const q = impliedOf(fav) / (impliedOf(fav) + impliedOf(dog)); // fav covers, as priced
  const expected = pFav - 0.15;
  const swapped = Math.abs(1 - q - expected) + 0.1 < Math.abs(q - expected);
  return swapped ? { home: a, away: h } : { home: h, away: a };
}

export const hasScore = (g: MlbGame) => g.away.score !== null && g.home.score !== null;

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function inningText(g: Pick<MlbGame, "inning" | "half">): string {
  if (!g.inning) return "";
  const h =
    g.half === "top"
      ? "Top"
      : g.half === "bottom"
        ? "Bot"
        : g.half === "mid"
          ? "Mid"
          : g.half === "end"
            ? "End"
            : "";
  return `${h} ${ordinal(g.inning)}`.trim();
}

export function statusText(game: MlbGame): string {
  if (game.status === "live") return `LIVE · ${inningText(game) || game.statusDetail}`;
  if (game.status === "final") return game.inning > 9 ? `Final/${game.inning}` : "Final";
  if (game.status === "postponed") return "Postponed";
  return game.date ? localTip(game.date) : "TBA";
}

/** Eastern-time day key (YYYY-MM-DD) for grouping a slate. */
export function etDayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Runs in the first five innings, once all five have been played (or the game ended). */
export function firstFive(side: MlbSide): number | null {
  const inn = side.innings ?? [];
  if (inn.length < 5) return null;
  return inn.slice(0, 5).reduce<number>((s, v) => s + (v ?? 0), 0);
}

/* ---------- divisions and standings ---------- */

export const MLB_DIVISIONS: { name: string; league: "AL" | "NL"; teams: string[] }[] = [
  { name: "AL East", league: "AL", teams: ["BAL", "BOS", "NYY", "TB", "TOR"] },
  { name: "AL Central", league: "AL", teams: ["CHW", "CLE", "DET", "KC", "MIN"] },
  { name: "AL West", league: "AL", teams: ["ATH", "OAK", "HOU", "LAA", "SEA", "TEX"] },
  { name: "NL East", league: "NL", teams: ["ATL", "MIA", "NYM", "PHI", "WSH"] },
  { name: "NL Central", league: "NL", teams: ["CHC", "CIN", "MIL", "PIT", "STL"] },
  { name: "NL West", league: "NL", teams: ["ARI", "COL", "LAD", "SD", "SF"] },
];

export const mlbDivisionOf = (abbr: string) =>
  MLB_DIVISIONS.find((d) => d.teams.includes(abbr.toUpperCase()));

export interface MlbStandingRow {
  teamId: string;
  team: MlbTeamRef;
  division: string;
  league: "AL" | "NL" | "";
  wins: number;
  losses: number;
  pct: number;
  /** Games behind the division leader (0 for the leader). */
  gb: number;
  runsFor: number;
  runsAgainst: number;
  home: [number, number];
  road: [number, number];
  last10: [number, number];
  /** "W3" / "L2". */
  streak: string;
}

/** Regular-season standings from finished games, best record first within each division. */
export function buildMlbStandings(games: MlbGame[]): MlbStandingRow[] {
  const done = games
    .filter((g) => g.part === "reg" && g.status === "final" && hasScore(g))
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = new Map<string, MlbStandingRow & { results: boolean[] }>();
  const row = (t: MlbTeamRef) => {
    let r = rows.get(t.id);
    if (!r) {
      const d = mlbDivisionOf(t.abbr);
      r = {
        teamId: t.id,
        team: t,
        division: d?.name ?? "",
        league: d?.league ?? "",
        wins: 0,
        losses: 0,
        pct: 0,
        gb: 0,
        runsFor: 0,
        runsAgainst: 0,
        home: [0, 0],
        road: [0, 0],
        last10: [0, 0],
        streak: "",
        results: [],
      };
      rows.set(t.id, r);
    }
    return r;
  };
  for (const g of done) {
    const a = g.away.score as number;
    const h = g.home.score as number;
    for (const [side, rf, ra, isHome] of [
      [g.away, a, h, false],
      [g.home, h, a, true],
    ] as const) {
      const r = row(side.team);
      const won = rf > ra;
      if (won) r.wins += 1;
      else r.losses += 1;
      r.runsFor += rf;
      r.runsAgainst += ra;
      const split = isHome ? r.home : r.road;
      split[won ? 0 : 1] += 1;
      r.results.push(won);
    }
  }
  const out = [...rows.values()].map(({ results, ...r }) => {
    const last = results.slice(-10);
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === results[results.length - 1]; i--)
      n += 1;
    return {
      ...r,
      pct: r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0,
      last10: [last.filter(Boolean).length, last.filter((x) => !x).length] as [number, number],
      streak: results.length ? `${results[results.length - 1] ? "W" : "L"}${n}` : "",
    };
  });
  for (const d of MLB_DIVISIONS) {
    const div = out.filter((r) => r.division === d.name);
    const lead = div.reduce((m, r) => Math.max(m, r.wins - r.losses), -Infinity);
    for (const r of div) r.gb = (lead - (r.wins - r.losses)) / 2;
  }
  return out.sort(
    (x, y) => y.pct - x.pct || y.runsFor - y.runsAgainst - (x.runsFor - x.runsAgainst),
  );
}

/* ---------- a team's record against the closing lines ---------- */

export interface MlbBetRecord {
  wins: number;
  losses: number;
  pushes: number;
  /** Profit in units staking 1 unit per game at the closing price (−110 if missing). */
  units: number;
}

export interface MlbTeamBetting {
  /** Backing the team on the moneyline every game. */
  moneyline: MlbBetRecord;
  asFavorite: MlbBetRecord;
  asUnderdog: MlbBetRecord;
  /** Backing the team on the run line (±1.5) every game. */
  runLine: MlbBetRecord;
  /** Overs and unders in the team's games (wins = overs). */
  overUnder: MlbBetRecord;
}

const payout = (price: number | null | undefined) =>
  price == null ? 100 / 110 : price < 0 ? 100 / -price : price / 100;
const blankBet = (): MlbBetRecord => ({ wins: 0, losses: 0, pushes: 0, units: 0 });
const grade = (r: MlbBetRecord, margin: number, price: number | null | undefined) => {
  if (margin > 0) {
    r.wins += 1;
    r.units += payout(price);
  } else if (margin < 0) {
    r.losses += 1;
    r.units -= 1;
  } else r.pushes += 1;
};

/** How the team did against the closing lines in finished regular-season games. */
export function mlbTeamBetting(games: MlbGame[], teamId: string): MlbTeamBetting {
  const out: MlbTeamBetting = {
    moneyline: blankBet(),
    asFavorite: blankBet(),
    asUnderdog: blankBet(),
    runLine: blankBet(),
    overUnder: blankBet(),
  };
  for (const g of games) {
    if (g.part !== "reg" || g.status !== "final" || !hasScore(g) || !g.odds) continue;
    const home = g.home.team.id === teamId;
    if (!home && g.away.team.id !== teamId) continue;
    const us = (home ? g.home.score : g.away.score) as number;
    const them = (home ? g.away.score : g.home.score) as number;
    const o = g.odds;
    const ml = home ? o.mlHome : o.mlAway;
    const opp = home ? o.mlAway : o.mlHome;
    if (ml != null && opp != null) {
      grade(out.moneyline, us - them, ml);
      grade(ml < opp ? out.asFavorite : out.asUnderdog, us - them, ml);
    }
    // Only with real, sensible run-line prices: ±1.5 is never close to −110.
    const rl = runLinePrices(o);
    const rlPrice = rl ? (home ? rl.home : rl.away) : null;
    if (o.spread != null && o.spread !== 0 && rlPrice != null) {
      const line = home ? o.spread : -o.spread;
      grade(out.runLine, us - them + line, rlPrice);
    }
    if (o.total != null) {
      const t = us + them;
      // Wins = overs; units = backing the over every game.
      grade(out.overUnder, t - o.total, o.overOdds);
    }
  }
  return out;
}
