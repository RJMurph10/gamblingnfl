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

const teamIdOf = (t) => {
  if (!t) return null;
  if (t.id != null) return String(t.id);
  const m = /\/teams\/(\d+)/.exec(String(t.$ref ?? ""));
  return m ? m[1] : null;
};

/**
 * True when the odds object's "home" team is the game's away team. ESPN does this for some
 * neutral-site games (about 3% of college games): its odds list the other school as home, so the
 * line would land on the wrong team. Checked by team id, else by the favorite named in "details".
 */
export function oddsSwapped(o, home) {
  if (!home?.id && !home?.abbr) return false;
  const hid = teamIdOf(o?.homeTeamOdds?.team);
  const aid = teamIdOf(o?.awayTeamOdds?.team);
  if (home.id && hid) return hid !== String(home.id) && (!aid || aid === String(home.id));
  const m = /^\s*([A-Za-z&.'-]+)\s+-\d/.exec(String(o?.details ?? ""));
  if (m && home.abbr && o?.homeTeamOdds?.favorite != null) {
    const favIsHome = m[1].toUpperCase() === String(home.abbr).toUpperCase();
    return favIsHome !== Boolean(o.homeTeamOdds.favorite);
  }
  return false;
}

/** The same line from the other team's side. */
export const swapLine = (l) => [l[0] === null ? null : -l[0], l[1], l[3], l[2], l[5], l[4], l[6], l[7]];

/**
 * The best book's line from a list of odds objects: DraftKings, then ESPN BET, then anything.
 * `home` ({ id, abbr }) is the game's home team, so a book that lists the teams the other way
 * round is turned around.
 */
export function bestLine(books, home) {
  const list = (books ?? []).filter(Boolean).filter(usable).sort((x, y) => rank(x) - rank(y));
  let fallback = null;
  for (const b of list) {
    const raw = lineOf(b);
    const l = oddsSwapped(b, home) ? swapLine(raw) : raw;
    if (l[0] !== null && l[1] !== null) return l;
    if (!fallback && (l[0] !== null || l[1] !== null || l[2] !== null)) fallback = l;
  }
  return fallback;
}

/**
 * The opening spread and total from the best book: [homeSpread, total]. ESPN's core odds keep them
 * per side (homeTeamOdds.open.pointSpread) and as open.total; scoreboard odds as pointSpread.home.open.
 */
export function openLine(books, home) {
  const list = (books ?? []).filter(Boolean).filter(usable).sort((x, y) => rank(x) - rank(y));
  for (const o of list) {
    const h = o?.homeTeamOdds ?? {};
    const a = o?.awayTeamOdds ?? {};
    const mlh = american(h.open?.moneyLine) ?? american(o?.moneyline?.home?.open?.odds);
    const mla = american(a.open?.moneyLine) ?? american(o?.moneyline?.away?.open?.odds);
    const raw = num(h.open?.pointSpread?.american ?? h.open?.pointSpread?.alternateDisplayValue ?? o?.pointSpread?.home?.open?.line);
    let spread = raw;
    if (spread !== null && spread !== 0) {
      if (mlh !== null && mla !== null && mlh !== mla) spread = mlh < mla ? -Math.abs(spread) : Math.abs(spread);
      else if (h.open?.favorite === true) spread = -Math.abs(spread);
      else if (a.open?.favorite === true) spread = Math.abs(spread);
    }
    const t = num(o?.open?.total?.american ?? o?.open?.total?.alternateDisplayValue ?? o?.total?.over?.open?.line);
    const total = t !== null && t > 0 ? t : null;
    if (spread === null && total === null) continue;
    return [oddsSwapped(o, home) && spread !== null ? -spread : spread, total];
  }
  return null;
}
