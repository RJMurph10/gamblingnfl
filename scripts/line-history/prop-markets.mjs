/**
 * Player-prop markets beyond the main over/unders, shared by the builders (build-upcoming.mjs,
 * build-props-site.mjs, build-props-history.mjs):
 *   - EXTRA_OU: more over/under markets (MLB total bases, NFL tackles…), graded like the main ones
 *   - SPECIALS: yes-only bets (anytime goalscorer, double-double, first basket…), one price each
 *   - MILESTONES: "X+" ladders (15+ points) shown as alternate over lines of the matching market
 * plus gameEvents(): the play-by-play facts the specials and MLB markets are graded on.
 */

/** ESPN market name → site label, over/under, per league (added to the builders' main maps). */
export const EXTRA_OU = {
  nfl: {
    "Total Tackles (incl. overtime)": "Tackles",
    "Total Tackles Plus Assists (incl. overtime)": "Tackles+Ast",
    "Total Assists (incl. overtime)": "Tackle ast",
    "Total Sacks (incl. overtime)": "Sacks",
    "Total Kicking Points (incl. overtime)": "Kicking pts",
    "Total Field Goals Made (incl. overtime)": "FGs made",
    "Total Extra Points Made (incl. overtime)": "XPs made",
    "Longest Reception (incl. overtime)": "Longest rec",
    "Longest Rush (incl. overtime)": "Longest rush",
  },
  mlb: {
    "Total Bases": "Total bases",
    "Total Singles Hit": "Singles",
    "Total Doubles Hit": "Doubles",
    "Total Stolen Bases": "Stolen bases",
    "Total Walks (Batter)": "Walks",
  },
  nba: { "Total Steals and Blocks": "Stl+Blk" },
  wnba: { "Total Steals and Blocks": "Stl+Blk" },
  nhl: {},
};

/** ESPN market name → site label, yes-only bets, per league. */
export const SPECIALS = {
  nhl: {
    "Anytime Goalscorer": "Anytime goal",
    "First Goalscorer": "First goal",
    "Last Goalscorer": "Last goal",
    "To Score 2+ Goals": "2+ goals",
    "To Score 3+ Goals": "Hat trick",
    "First Team Goalscorer": "First team goal",
  },
  nba: {
    "To Record a Double Double": "Double-double",
    "To Record a Triple Double": "Triple-double",
    "First Basket": "First basket",
    "1st Team FG Scorer": "First team basket",
  },
  wnba: {
    "To Record a Double Double": "Double-double",
    "To Record a Triple Double": "Triple-double",
    "First Basket": "First basket",
    "1st Team FG Scorer": "First team basket",
  },
  mlb: {
    "First Home Run Hitter": "First home run",
    "To Record Win": "Win (pitcher)",
  },
  nfl: {},
};

/** ESPN milestone market → the site label of the over/under it ladders, per league. */
export const MILESTONES = {
  nba: {
    "Points Milestones": "Points",
    "Rebounds Milestones": "Rebounds",
    "Assists Milestones": "Assists",
    "3-Point Field Goals Milestones": "3-pointers",
    "Steals Milestones": "Steals",
    "Blocks Milestones": "Blocks",
    "Points + Assists + Rebounds Milestones": "Pts+Reb+Ast",
    "Points + Rebounds Milestones": "Pts+Reb",
    "Points + Assists Milestones": "Pts+Ast",
    "Rebounds + Assists Milestones": "Reb+Ast",
    "Steals + Blocks Milestones": "Stl+Blk",
  },
  wnba: {
    "Points Milestones": "Points",
    "Rebounds Milestones": "Rebounds",
    "Assists Milestones": "Assists",
    "3-Point Field Goals Milestones": "3-pointers",
    "Points + Assists + Rebounds Milestones": "Pts+Reb+Ast",
    "Points + Rebounds Milestones": "Pts+Reb",
    "Points + Assists Milestones": "Pts+Ast",
  },
  nhl: {
    "Points Milestones": "Points",
    "Assists Milestones": "Assists",
    "Shots on Goal Milestones": "Shots on goal",
    "Blocked Shots Milestones": "Blocked shots",
    "Goalkeeper Saves Milestones": "Saves",
  },
  mlb: {
    "Hits Milestones": "Hits",
    "Total Bases Milestones": "Total bases",
    "RBIs Milestones": "RBIs",
    "Home Runs Milestones": "Home runs",
    "Singles Milestones": "Singles",
    "Doubles Milestones": "Doubles",
    "Runs Milestones": "Runs",
    "Stolen Bases Milestones": "Stolen bases",
    "Hits + Runs + RBIs Milestones": "Hits+Runs+RBIs",
    "Walks (Batter) Milestones": "Walks",
    "Strikeouts Thrown Milestones": "Pitcher strikeouts",
  },
  nfl: {
    "Passing Yards Milestones": "Pass yds",
    "Receiving Yards Milestones": "Rec yds",
    "Rushing Yards Milestones": "Rush yds",
    "Rushing + Receiving Yards Milestones": "Rush+Rec yds",
    "Receptions Milestones": "Receptions",
    "Passing Touchdown Milestones": "Pass TDs",
    "Passing Attempts Milestones": "Pass att",
    "Passing Completions Milestones": "Completions",
    "Rushing Attempts Milestones": "Carries",
    "Passing + Rushing Yards Milestones": "Pass+Rush yds",
    "Interceptions Thrown Milestones": "Interceptions",
    "Assists Milestones (Football)": "Tackle ast",
    "Kicking Points Milestones": "Kicking pts",
    "Field Goals Made Milestones": "FGs made",
    "Tackles Milestones": "Tackles",
    "Tackles + Assists Milestones": "Tackles+Ast",
    "Sacks Milestones": "Sacks",
  },
};

/** A yes-only row's price: ESPN BET's labeled over, else DraftKings' unlabeled side (current, then open). */
export function yesPrice(r, close = true) {
  const labeled = close ? (r.cur?.[1] ?? r.op?.[1]) : (r.op?.[1] ?? r.cur?.[1]);
  if (labeled != null) return labeled;
  if (!r.px) return null;
  return close ? (r.px[0] ?? r.px[1]) : (r.px[1] ?? r.px[0]);
}

/**
 * Specials from one snapshot's rows: [[athlete id, label, price, opening price]], one per player and
 * market. price = the latest ESPN kept (the close, for a finished game).
 */
export function specialsOf(rows, league) {
  const map = SPECIALS[league] ?? {};
  const out = new Map();
  for (const r of rows ?? []) {
    const label = map[r.t];
    if (!label || !r.a) continue;
    const price = yesPrice(r, true);
    if (price == null) continue;
    const k = `${r.a}|${label}`;
    if (!out.has(k)) out.set(k, [String(r.a), label, price, yesPrice(r, false)]);
  }
  return [...out.values()];
}

/**
 * Milestone ladders from one snapshot's rows: Map("athlete|label" → [[line, price], ...]), each "X+"
 * as the over X − 0.5 (15+ points = over 14.5), sorted by line.
 */
export function milestonesOf(rows, league, close = true) {
  const map = MILESTONES[league] ?? {};
  const out = new Map();
  for (const r of rows ?? []) {
    const label = map[r.t];
    if (!label || !r.a) continue;
    const target = (close ? (r.cur?.[0] ?? r.op?.[0]) : (r.op?.[0] ?? r.cur?.[0])) ?? null;
    const price = yesPrice(r, close);
    if (target == null || price == null) continue;
    const k = `${r.a}|${label}`;
    const ladder = out.get(k) ?? new Map();
    ladder.set(target - 0.5, price);
    out.set(k, ladder);
  }
  return new Map([...out].map(([k, m]) => [k, [...m].sort((x, y) => x[0] - y[0])]));
}

const lastName = (n) =>
  String(n ?? "")
    .replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "")
    .trim()
    .split(/\s+/)
    .pop()
    ?.toLowerCase() ?? "";

/** The winning pitcher's athlete id, wherever the summary carries it (header status, competitors). */
function winningPitcher(summary) {
  const seen = new Set();
  const walk = (x, depth) => {
    if (!x || typeof x !== "object" || depth > 6 || seen.has(x)) return null;
    seen.add(x);
    const tag = String(x.name ?? x.abbreviation ?? x.type ?? "");
    if (/^(winningPitcher|W)$/.test(tag) && x.athlete?.id) return String(x.athlete.id);
    for (const v of Array.isArray(x) ? x : Object.values(x)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(summary?.header, 0);
}

/**
 * Play-by-play facts for grading, from an ESPN game summary (team keys are abbreviations):
 *   nhl: { fg, lg, ftg: { [team]: athleteId } }  first / last goal scorer, each team's first (no shootout)
 *   nba / wnba: { fb, ftb: { [team]: athleteId } }  first made field goal, each team's first
 *   mlb: { fhr, w, bat: { athleteId: { "1B", "2B", "3B", SB } } }  first home run, winning pitcher,
 *        hit types and steals from the play text
 * box (athleteId → { n }) matches MLB stolen-base plays, which name the runner by last name only.
 */
export function gameEvents(summary, league, box = {}) {
  const plays = summary?.plays ?? [];
  if (!plays.length) return null;
  const comp = summary?.header?.competitions?.[0];
  const abbr = new Map(
    (comp?.competitors ?? []).map((c) => [String(c.team?.id ?? c.id ?? ""), String(c.team?.abbreviation ?? "")]),
  );
  const teamOf = (p) => abbr.get(String(p.team?.id ?? "")) || null;
  const pid = (p, type) =>
    String((type ? p.participants?.find((x) => x.type === type) : p.participants?.[0])?.athlete?.id ?? "") || null;
  if (league === "nhl") {
    const playoffs = Number(summary?.header?.season?.type) === 3;
    const goals = plays.filter(
      (p) =>
        p.scoringPlay &&
        !/shootout/i.test(`${p.type?.text ?? ""} ${p.period?.type ?? ""}`) &&
        (playoffs || Number(p.period?.number ?? 1) <= 4),
    );
    const scorer = (g) => pid(g, "scorer") ?? pid(g);
    const ftg = {};
    for (const g of goals) {
      const t = teamOf(g);
      if (t && !ftg[t]) ftg[t] = scorer(g);
    }
    return { fg: goals.length ? scorer(goals[0]) : null, lg: goals.length ? scorer(goals.at(-1)) : null, ftg };
  }
  if (league === "nba" || league === "wnba") {
    const fgs = plays.filter(
      (p) => p.scoringPlay && !/free throw/i.test(`${p.type?.text ?? ""} ${p.text ?? ""}`),
    );
    const ftb = {};
    for (const b of fgs) {
      const t = teamOf(b);
      if (t && !ftb[t]) ftb[t] = pid(b);
    }
    return { fb: fgs.length ? pid(fgs[0]) : null, ftb };
  }
  if (league === "mlb") {
    const bat = {};
    const add = (a, k) => {
      if (!a) return;
      bat[a] ??= { "1B": 0, "2B": 0, "3B": 0, SB: 0 };
      bat[a][k] += 1;
    };
    const byLast = new Map();
    for (const [a, b] of Object.entries(box)) {
      const k = lastName(b.n);
      byLast.set(k, byLast.has(k) ? null : a); // a last name two players share stays unmatched
    }
    let fhr = null;
    const seen = new Set();
    for (const p of plays) {
      const text = String(p.text ?? "");
      if (!/\b(homered|tripled|doubled|singled|stole)\b/i.test(text)) continue;
      // the same result can be repeated across a plate appearance's play items
      const key = `${p.atBatId ?? p.period?.number ?? ""}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const batter = pid(p, "batter");
      if (/\bhomered\b/i.test(text)) fhr ??= batter;
      else if (/\btripled\b/i.test(text)) add(batter, "3B");
      else if (/\bdoubled\b/i.test(text)) add(batter, "2B");
      else if (/\bsingled\b/i.test(text)) add(batter, "1B");
      for (const m of text.matchAll(/([A-Z][\w'.-]+(?: [A-Z][\w'.-]+)*) stole (?:second|third|home)/g))
        add(byLast.get(lastName(m[1])) ?? null, "SB");
    }
    return { fhr, w: winningPitcher(summary), bat };
  }
  return null;
}
