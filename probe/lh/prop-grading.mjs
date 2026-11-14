/**
 * Player-prop grading shared by the builders (build-props-site.mjs, build-props-history.mjs) and the site's
 * live Props tab (src/lib/shared/live-props.server.ts): ESPN market name → site label and the stat from a
 * box score, the box score itself from an ESPN game summary, and yes-only bet results. No Node imports,
 * so the site's server bundle can use it too.
 */
import { EXTRA_OU, SPECIALS } from "./prop-markets.mjs";

export const num = (v) => {
  const n = Number(String(v ?? "").split(/[-/]/)[0]);
  return Number.isFinite(n) ? n : null;
};
const sum = (...v) => (v.every((x) => x !== null) ? v.reduce((a, b) => a + b, 0) : null);

/** Market name → [short label, stat from the box score]. */
const NBA = {
  "Total Points": ["Points", (s) => num(s.PTS)],
  "Total Rebounds": ["Rebounds", (s) => num(s.REB)],
  "Total Assists": ["Assists", (s) => num(s.AST)],
  "Total 3-Point Field Goals": ["3-pointers", (s) => num(s["3PT"])],
  "Total Points, Rebounds, and Assists": [
    "Pts+Reb+Ast",
    (s) => sum(num(s.PTS), num(s.REB), num(s.AST)),
  ],
  "Total Points and Rebounds": ["Pts+Reb", (s) => sum(num(s.PTS), num(s.REB))],
  "Total Points and Assists": ["Pts+Ast", (s) => sum(num(s.PTS), num(s.AST))],
  "Total Assists and Rebounds": ["Reb+Ast", (s) => sum(num(s.AST), num(s.REB))],
  "Total Steals": ["Steals", (s) => num(s.STL)],
  "Total Blocks": ["Blocks", (s) => num(s.BLK)],
  "Total Turnovers": ["Turnovers", (s) => num(s.TO)],
};
const att = (s) => num(String(s["passing.C/ATT"] ?? "").split("/")[1]);
const cmp = (s) => num(String(s["passing.C/ATT"] ?? "").split("/")[0]);
const FB = {
  "Total Passing Yards (incl. overtime)": ["Pass yds", (s) => num(s["passing.YDS"])],
  "Total Passing Attempts (incl. overtime)": ["Pass att", att],
  "Total Pass Completions (incl. overtime)": ["Completions", cmp],
  "Total Passing Touchdowns (incl. overtime)": ["Pass TDs", (s) => num(s["passing.TD"])],
  "Total Passing Interceptions (incl. overtime)": ["Interceptions", (s) => num(s["passing.INT"])],
  "Total Rushing Yards (incl. overtime)": [
    "Rush yds",
    (s) => num(s["rushing.YDS"]) ?? (s["passing.YDS"] != null ? 0 : null),
  ],
  "Total Carries (incl. overtime)": ["Carries", (s) => num(s["rushing.CAR"])],
  "Total Receiving Yards (incl. overtime)": ["Rec yds", (s) => num(s["receiving.YDS"]) ?? 0],
  "Total Receptions (incl. overtime)": ["Receptions", (s) => num(s["receiving.REC"]) ?? 0],
  "Total Rushing Plus Receiving Yards (incl. overtime)": [
    "Rush+Rec yds",
    (s) => (num(s["rushing.YDS"]) ?? 0) + (num(s["receiving.YDS"]) ?? 0),
  ],
  "Total Passing Plus Rushing Yards (incl. overtime)": [
    "Pass+Rush yds",
    (s) => (num(s["passing.YDS"]) ?? 0) + (num(s["rushing.YDS"]) ?? 0),
  ],
};
const nhl = (s, k) => num(s[`forwards.${k}`] ?? s[`defenses.${k}`] ?? s[`goalies.${k}`] ?? s[k]);
const NHL = {
  "Total Points": ["Points", (s) => sum(nhl(s, "G"), nhl(s, "A"))],
  "Total Goals": ["Goals", (s) => nhl(s, "G")],
  "Total Assists": ["Assists", (s) => nhl(s, "A")],
  // ESPN's box "SOG" column is always 0; "S" is shots on goal (missed shots are "SM")
  "Total Shots on Goal": ["Shots on goal", (s) => nhl(s, "S") ?? nhl(s, "SOG")],
  "Total Hits": ["Hits", (s) => nhl(s, "HT")],
  "Total Blocked Shots": ["Blocked shots", (s) => nhl(s, "BS")],
  "Total Saves": ["Saves", (s) => nhl(s, "SV")],
};
// MLB box scores mix batting and pitching labels; pitchers are the rows with innings pitched.
const isPitcher = (s) => s.IP != null;
const outs = (ip) => {
  const [w, f] = String(ip ?? "").split(".");
  const n = Number(w);
  return Number.isFinite(n) ? n * 3 + (Number(f) || 0) : null;
};
const bat = (k) => (s) => (isPitcher(s) && s.AB == null ? null : num(s[k]));
const pit = (k) => (s) => (isPitcher(s) ? num(s[k]) : null);
const MLB = {
  "Total Hits": ["Hits", bat("H")],
  "Total Home Runs Hit": ["Home runs", bat("HR")],
  "Total Runs Scored": ["Runs", bat("R")],
  "Total RBIs": ["RBIs", bat("RBI")],
  "Total Hits + Runs + RBIs": [
    "Hits+Runs+RBIs",
    (s) => sum(bat("H")(s), bat("R")(s), bat("RBI")(s)),
  ],
  "Total Strikeouts": ["Pitcher strikeouts", pit("K")],
  "Earned Runs Allowed": ["Earned runs allowed", pit("ER")],
  "Total Walks Allowed": ["Walks allowed", pit("BB")],
  "Total Hits Allowed": ["Hits allowed", pit("H")],
  "Total Outs Recorded": ["Outs recorded", (s) => (isPitcher(s) ? outs(s.IP) : null)],
};
/**
 * Graders for the extra over/unders in prop-markets.mjs, by site label. (s, { a, g }): the player's box
 * line, their athlete id and the game (g.ev holds the play-by-play facts).
 */
const def = (k) => (s) => num(s[`defensive.${k}`]) ?? 0;
/** A batter's hit types from the plays, only when they add up to the box score's hits. */
const hitTypes = (s, { a, g }) => {
  if (!g.ev?.bat || (isPitcher(s) && s.AB == null)) return null;
  const b = g.ev.bat[a] ?? { "1B": 0, "2B": 0, "3B": 0, SB: 0 };
  const hr = num(s.HR) ?? 0;
  return b["1B"] + b["2B"] + b["3B"] + hr === num(s.H) ? { ...b, HR: hr } : null;
};
const EXTRA_GRADE = {
  Tackles: def("SOLO"),
  "Tackles+Ast": def("TOT"),
  "Tackle ast": (s) => (num(s["defensive.TOT"]) ?? 0) - (num(s["defensive.SOLO"]) ?? 0),
  Sacks: def("SACKS"),
  "Kicking pts": (s) => num(s["kicking.PTS"]) ?? 0,
  "FGs made": (s) => num(s["kicking.FG"]) ?? 0,
  "XPs made": (s) => num(s["kicking.XP"]) ?? 0,
  "Longest rec": (s) => num(s["receiving.LONG"]) ?? 0,
  "Longest rush": (s) => num(s["rushing.LONG"]) ?? 0,
  "Total bases": (s, c) => {
    const h = hitTypes(s, c);
    return h ? h["1B"] + 2 * h["2B"] + 3 * h["3B"] + 4 * h.HR : null;
  },
  Singles: (s, c) => hitTypes(s, c)?.["1B"] ?? null,
  Doubles: (s, c) => hitTypes(s, c)?.["2B"] ?? null,
  "Stolen bases": (s, { a, g }) =>
    g.ev?.bat && !(isPitcher(s) && s.AB == null) ? (g.ev.bat[a]?.SB ?? 0) : null,
  Walks: bat("BB"),
  "Stl+Blk": (s) => sum(num(s.STL), num(s.BLK)),
  "Field goals": (s) => num(s.FG),
};
/** A league's markets: ESPN market name → [site label, stat (box line, { a: athlete id, g: game })]. */
export function marketsFor(league) {
  const out = { ...({ nba: NBA, wnba: NBA, nfl: FB, cfb: FB, nhl: NHL, mlb: MLB }[league] ?? {}) };
  for (const [t, label] of Object.entries(EXTRA_OU[league] ?? {}))
    if (EXTRA_GRADE[label]) out[t] = [label, EXTRA_GRADE[label]];
  return out;
}

/** Touchdowns a player scored (rushing, receiving, kick and punt returns; passing TDs don't count). */
const touchdowns = (s) =>
  ["rushing.TD", "receiving.TD", "kickReturns.TD", "puntReturns.TD"].reduce(
    (t, k) => t + (num(s[k]) ?? 0),
    0,
  );
/** 1 if this player scored the game's first / last touchdown, 0 once someone else did, null before. */
const scorer =
  (key) =>
  (s, { a, g }) => {
    const id = g.ev?.[key];
    return id == null ? null : id === a ? 1 : 0;
  };
/**
 * Touchdown-scorer bets as over/under rows on the site (anytime = over 0.5 TDs, 2+ = over 1.5; first and
 * last TD = over 0.5 of "scored it"). Live grading only: the prop history doesn't keep these.
 */
export const TD_MARKETS = {
  "Anytime TD": touchdowns,
  "2+ TDs": touchdowns,
  "First TD": scorer("ftd"),
  "Last TD": scorer("ltd"),
};

/** 1st-half and quarter props (SportsGameOdds lines): label prefix → quarters it covers. */
export const PERIOD_PREFIX = { "1H": [1, 2], "1Q": [1], "2Q": [2], "3Q": [3], "4Q": [4] };
/** Site label (after the prefix) → the play-by-play stats it adds up (footballPeriods in prop-markets.mjs). */
export const PERIOD_MARKETS = {
  "Pass yds": ["py"],
  "Pass att": ["pa"],
  Completions: ["pc"],
  "Pass TDs": ["ptd"],
  Interceptions: ["int"],
  "Rush yds": ["ry"],
  Carries: ["car"],
  "Rec yds": ["rcy"],
  Receptions: ["rec"],
  "Pass+Rush yds": ["py", "ry"],
  "Rush+Rec yds": ["ry", "rcy"],
};
/**
 * A player's number for a 1st-half / quarter prop from the play-by-play (g.ev.per), only when his
 * quarters add up to his box score for every stat it uses; null otherwise (left ungraded).
 */
const periodStat =
  (quarters, keys) =>
  (s, { a, g }) => {
    const ev = g.ev;
    if (!ev?.per) return null;
    if (keys.some((k) => ev.bad?.[a]?.includes(k))) return null;
    let v = 0;
    for (const q of quarters) for (const k of keys) v += ev.per[a]?.[q]?.[k] ?? 0;
    return v;
  };
/** Longest completion (full game), from the play-by-play, when the passer's yards add up. */
const longestCompletion = (s, { a, g }) => {
  if (!g.ev?.per || g.ev.bad?.[a]?.includes("py")) return null;
  if (s["passing.YDS"] == null) return null;
  return g.ev.lc?.[a] ?? 0;
};

/** Site label → stat, for a league. */
export function statsByLabel(league) {
  const out = new Map(Object.values(marketsFor(league)).map(([label, fn]) => [label, fn]));
  if (league === "nfl" || league === "cfb") {
    for (const [label, fn] of Object.entries(TD_MARKETS)) out.set(label, fn);
    out.set("Longest comp", longestCompletion);
    for (const [pre, quarters] of Object.entries(PERIOD_PREFIX))
      for (const [label, keys] of Object.entries(PERIOD_MARKETS))
        out.set(`${pre} ${label}`, periodStat(quarters, keys));
  }
  return out;
}

/** The yes-only bets' site labels for a league. */
export const specialLabels = (league) => Object.values(SPECIALS[league] ?? {});

/**
 * Every player's box-score line from an ESPN game summary: athleteId → { n, tm, pos, s, dnp? }, stats
 * keyed by label, prefixed with the stat group outside the NBA ("passing.YDS", "forwards.G").
 */
export function boxFrom(summary, league) {
  const out = {};
  for (const team of summary?.boxscore?.players ?? []) {
    const abbr = team?.team?.abbreviation ?? "";
    for (const group of team?.statistics ?? []) {
      const prefix = league !== "nba" && group?.name ? `${group.name}.` : "";
      const labels = group?.labels ?? group?.keys ?? [];
      for (const a of group?.athletes ?? []) {
        const id = a?.athlete?.id;
        if (!id) continue;
        const row = (out[id] ??= {
          n: a.athlete.displayName ?? "",
          tm: abbr,
          pos: a.athlete.position?.abbreviation ?? "",
          s: {},
        });
        if (a.didNotPlay) row.dnp = true;
        (a.stats ?? []).forEach((v, i) => {
          if (labels[i]) row.s[`${prefix}${labels[i]}`] = v;
        });
      }
    }
  }
  return out;
}

/** Did a yes-only bet win? 1 / 0, "void" (didn't play), null (not enough saved to tell). */
export function gradeSpecial(label, a, g) {
  const bx = g.box?.[a];
  if (!bx) return null;
  if (bx.dnp) return "void";
  const s = bx.s ?? {};
  const ev = g.ev;
  const first = (id) => (ev ? (id === a ? 1 : 0) : null);
  const at = (n, k) => (n == null ? null : n >= k ? 1 : 0);
  switch (label) {
    case "Anytime goal":
      return at(nhl(s, "G"), 1);
    case "2+ goals":
      return at(nhl(s, "G"), 2);
    case "Hat trick":
      return at(nhl(s, "G"), 3);
    case "First goal":
      return first(ev?.fg);
    case "Last goal":
      return first(ev?.lg);
    case "First team goal":
      return first(ev?.ftg?.[bx.tm]);
    case "Double-double":
    case "Triple-double": {
      const v = [s.PTS, s.REB, s.AST, s.STL, s.BLK].map(num);
      if (v.some((x) => x == null)) return null;
      return at(v.filter((x) => x >= 10).length, label === "Double-double" ? 2 : 3);
    }
    case "First basket":
      return first(ev?.fb);
    case "First team basket":
      return first(ev?.ftb?.[bx.tm]);
    case "First 3-pointer":
      return ev && "f3" in ev ? first(ev.f3) : null;
    case "First home run":
      return first(ev?.fhr);
    case "Win (pitcher)":
      return ev?.w ? (ev.w === a ? 1 : 0) : null;
    default:
      return null;
  }
}
