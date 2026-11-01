/**
 * Reading game lines from ESPN odds objects (scoreboard odds, core odds feed, and the copies the hourly
 * line saver keeps). Shared by the CBB season builder and the history export.
 *   close = [homeSpread, total, mlHome, mlAway, spreadOddsHome, spreadOddsAway, overOdds, underOdds]
 * The spread is the home team's (negative = home favored).
 */
export const american = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "object") return american(v.american ?? v.alternateDisplayValue ?? v.value ?? v.odds);
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
};
export const num = (v) => {
  if (v == null || v === "") return null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(v).replace(/^\s*[ou]\s*/i, ""));
  return m ? Number(m[1]) : null;
};

/** Home spread with the sign checked against the favorite. */
function homeSpread(raw, mlHome, mlAway, h, a) {
  let s = num(raw);
  if (s === null) return null;
  if (s !== 0 && mlHome !== null && mlAway !== null && mlHome !== mlAway)
    s = mlHome < mlAway ? -Math.abs(s) : Math.abs(s);
  else if (s !== 0 && h?.favorite === true) s = -Math.abs(s);
  else if (s !== 0 && a?.favorite === true) s = Math.abs(s);
  return s;
}

export function lineOf(o) {
  const h = o?.homeTeamOdds ?? {};
  const a = o?.awayTeamOdds ?? {};
  const mlHome = american(h.moneyLine) ?? american(o?.moneyline?.home?.close?.odds);
  const mlAway = american(a.moneyLine) ?? american(o?.moneyline?.away?.close?.odds);
  const spread = homeSpread(o?.pointSpread?.home?.close?.line ?? o?.spread, mlHome, mlAway, h, a);
  const total = num(o?.overUnder) ?? num(o?.total?.over?.close?.line);
  return [
    spread,
    total !== null && total > 0 ? total : null,
    mlHome,
    mlAway,
    american(h.close?.spread) ?? american(h.spreadOdds) ?? american(o?.pointSpread?.home?.close?.odds),
    american(a.close?.spread) ?? american(a.spreadOdds) ?? american(o?.pointSpread?.away?.close?.odds),
    american(o?.overOdds) ?? american(o?.total?.over?.close?.odds),
    american(o?.underOdds) ?? american(o?.total?.under?.close?.odds),
  ];
}

const rank = (b) => {
  const id = String(b?.provider?.id ?? "");
  return ["100", "40"].includes(id) ? 0 : id === "58" ? 1 : 2;
};
const usable = (b) => {
  const name = String(b?.provider?.name ?? "");
  return !/live|accuscore|numberfire|teamrankings/i.test(name);
};

/** The best book's line from a list of odds objects: DraftKings, then ESPN BET, then anything. */
export function bestLine(books) {
  const list = (books ?? []).filter(Boolean).filter(usable).sort((x, y) => rank(x) - rank(y));
  let fallback = null;
  for (const b of list) {
    const l = lineOf(b);
    if (l[0] !== null && l[1] !== null) return l;
    if (!fallback && (l[0] !== null || l[1] !== null || l[2] !== null)) fallback = l;
  }
  return fallback;
}
