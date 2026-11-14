/**
 * Every priced game market and player period prop in one SportsGameOdds NFL event, each book's main line,
 * for the site's "More markets" panel and the quarter/half edge finder (scripts/props/nfl-partials.mjs).
 * Costs nothing extra: these come in the same events the props pull already buys.
 *
 * Game markets: [period, betType, who, stat, { book: [line, a, b, c] }]
 *   period  game | 1h | 2h | 1q | 2q | 3q | 4q
 *   betType ou  [line, over, under]           (who: all | home | away)
 *           sp  [home spread, home, away]      (who: "")
 *           ml  [null, home, away]             (who: "")
 *           ml3way [null, home, away, tie]     (who: "")
 *           yn  [null, yes, no]                (who: all | home | away)
 *           eo  [null, even, odd]              (who: all | home | away)
 *   The full-game spread, total and moneyline are left out (best-lines/<league>.json has them).
 * Player period props: [player, period, label, { book: [line, over, under] }]  (1st half, quarters)
 *   label "Anytime TD" rows are [null, yes, null].
 */
const num = (v) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

/** Player stats shown for the 1st half and quarters (SportsGameOdds stat id → label). */
export const PERIOD_STATS = {
  passing_yards: "Pass yds",
  passing_touchdowns: "Pass TDs",
  passing_completions: "Completions",
  passing_attempts: "Pass att",
  passing_interceptions: "Interceptions",
  "passing+rushing_yards": "Pass+Rush yds",
  rushing_yards: "Rush yds",
  receiving_yards: "Rec yds",
  receiving_receptions: "Receptions",
  "rushing+receiving_yards": "Rush+Rec yds",
};

const SIDE_SLOT = {
  ou: { over: 1, under: 2 },
  sp: { home: 1, away: 2 },
  ml: { home: 1, away: 2 },
  ml3way: { home: 1, away: 2, draw: 3 },
  yn: { yes: 1, no: 2 },
  eo: { even: 1, odd: 2 },
};

const live = (b) => b && b.available !== false;

/** Game markets (see the header). */
export function marketsOf(e) {
  const out = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    if (m.playerID || m.started) continue;
    const slot = SIDE_SLOT[m.betTypeID]?.[m.sideID];
    if (!slot) continue;
    const who = ["sp", "ml", "ml3way"].includes(m.betTypeID) ? "" : (m.statEntityID ?? "all");
    if (m.periodID === "game" && m.statID === "points" && (who === "" || who === "all")) continue;
    const key = `${m.periodID}|${m.betTypeID}|${who}|${m.statID}`;
    const row = out.get(key) ?? [m.periodID, m.betTypeID, who, m.statID, {}];
    for (const [book, b] of Object.entries(m.byBookmaker ?? {})) {
      if (!live(b)) continue;
      const price = num(b.odds);
      if (price == null) continue;
      const line =
        m.betTypeID === "ou" ? num(b.overUnder) : m.betTypeID === "sp" ? num(b.spread) : null;
      if ((m.betTypeID === "ou" || m.betTypeID === "sp") && line == null) continue;
      const cell = row[4][book] ?? [null, null, null, null];
      // spreads: keep the home number; over and under (home and away) must share a line
      const lineHome = m.betTypeID === "sp" && m.sideID === "away" ? -line : line;
      if (cell[0] == null) cell[0] = lineHome;
      else if (lineHome != null && cell[0] !== lineHome) continue;
      cell[slot] = price;
      row[4][book] = cell;
    }
    out.set(key, row);
  }
  const rows = [];
  for (const r of out.values()) {
    for (const [book, c] of Object.entries(r[4])) {
      const cell = r[1] === "ml3way" ? c : c.slice(0, 3);
      if (cell.slice(1).every((x) => x == null)) delete r[4][book];
      else r[4][book] = cell;
    }
    if (Object.keys(r[4]).length) rows.push(r);
  }
  return rows.sort((a, b) =>
    `${a[0]}|${a[1]}|${a[2]}|${a[3]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}|${b[3]}`),
  );
}

/** Player props for the 1st half and quarters (see the header). */
export function periodPropsOf(e) {
  const out = new Map();
  for (const m of Object.values(e.odds ?? {})) {
    if (!m.playerID || m.periodID === "game" || m.started) continue;
    const td = m.statID === "touchdowns" && m.betTypeID === "yn" && m.sideID === "yes";
    const label = td ? "Anytime TD" : m.betTypeID === "ou" ? PERIOD_STATS[m.statID] : null;
    if (!label) continue;
    const p = e.players?.[m.playerID];
    const name = p?.name ?? [p?.firstName, p?.lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const key = `${m.playerID}|${m.periodID}|${label}`;
    const row = out.get(key) ?? [name, m.periodID, label, {}];
    for (const [book, b] of Object.entries(m.byBookmaker ?? {})) {
      if (!live(b)) continue;
      const price = num(b.odds);
      if (price == null) continue;
      const line = td ? null : num(b.overUnder);
      if (!td && line == null) continue;
      const cell = row[3][book] ?? [line, null, null];
      if (cell[0] !== line) continue;
      if (td || m.sideID === "over") cell[1] = price;
      else if (m.sideID === "under") cell[2] = price;
      row[3][book] = cell;
    }
    if (Object.keys(row[3]).length) out.set(key, row);
  }
  return [...out.values()].sort(
    (a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]),
  );
}

/** The middle of the books' full-game home spread and total: [home spread (− = home favored), total]. */
export function fullLineOf(books) {
  const mid = (xs) => {
    const v = xs.filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  return [mid(books.map((b) => b.spread?.[0])), mid(books.map((b) => b.total?.[0]))];
}
