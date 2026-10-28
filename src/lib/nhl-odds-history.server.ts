/**
 * Server-only: ESPN's opening and closing NHL lines for past games, for the odds export page.
 *
 * Two small steps so no single request does too much work:
 *  1. fetchNhlWeekEvents(start) lists one week's finished regular-season games (the page walks the season).
 *  2. fetchNhlOddsRows(games) reads each game's core odds feed and returns one row per sportsbook with the
 *     opening and closing moneyline, puck line and total, plus their prices. A value ESPN does not have stays
 *     empty; nothing is estimated.
 */
import { parseEvent } from "./nhl.server";
import { priceToAmerican } from "./props.parse";
import type { NhlGame } from "./nhl";
import type { NhlOddsRow, NhlPastGame } from "./nhl-odds-history";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";
const CORE = "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl";

async function fetchJson(url: string): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "GamblingNFL/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

const toPast = (g: NhlGame): NhlPastGame => ({
  id: g.id,
  date: g.date,
  away: g.away.team.abbr,
  home: g.home.team.abbr,
  awayScore: g.away.score,
  homeScore: g.home.score,
  detail: g.statusDetail,
});

/**
 * Finished regular-season games for one week starting on `start` (YYYYMMDD). Tries ESPN's date-range form
 * first, then each day on its own (ESPN rejects the range form at times). Errors are returned, not hidden.
 */
export async function fetchNhlWeekEvents(start: string): Promise<{ games: NhlPastGame[]; errors: string[] }> {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(4, 6)) - 1;
  const d = Number(start.slice(6, 8));
  const days = Array.from({ length: 7 }, (_, i) => ymd(new Date(y, m, d + i)));
  const errors: string[] = [];
  const byId = new Map<string, NhlGame>();
  let total = 0;
  const take = (json: any) => {
    for (const e of Array.isArray(json?.events) ? json.events : []) {
      total++;
      const g = parseEvent(e);
      if (g && g.part === "reg" && g.status === "final") byId.set(g.id, g);
    }
  };
  try {
    take(await fetchJson(`${SITE}/scoreboard?dates=${days[0]}-${days[6]}&limit=200`));
  } catch (err) {
    errors.push(`range ${days[0]}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!total) {
    for (const day of days) {
      try {
        take(await fetchJson(`${SITE}/scoreboard?dates=${day}&limit=100`));
      } catch (err) {
        errors.push(`${day}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { games: [...byId.values()].sort((a, b) => a.date.localeCompare(b.date)).map(toPast), errors };
}

const odds = (...vals: any[]): string => {
  for (const v of vals) {
    const a = priceToAmerican(v);
    if (a) return a;
  }
  return "";
};

const line = (...vals: any[]): string => {
  for (const v of vals) {
    const raw = v && typeof v === "object" ? (v.value ?? v.displayValue ?? v.american) : v;
    if (raw === undefined || raw === null || raw === "") continue;
    const m = /(-?\d+(?:\.\d+)?)/.exec(String(raw).replace(/^\s*[ou]\s*/i, ""));
    if (m) return m[1];
  }
  return "";
};

/** Reads one ESPN odds item into open / close values. Several field layouts are tried. */
function oddsRow(game: NhlPastGame, o: any): NhlOddsRow {
  const h = o?.homeTeamOdds ?? {};
  const a = o?.awayTeamOdds ?? {};
  return {
    gameId: game.id,
    date: game.date,
    away: game.away,
    home: game.home,
    awayScore: game.awayScore === null ? "" : String(game.awayScore),
    homeScore: game.homeScore === null ? "" : String(game.homeScore),
    detail: game.detail,
    provider: String(o?.provider?.name ?? o?.provider?.displayName ?? o?.provider?.id ?? ""),
    mlAwayOpen: odds(o?.moneyline?.away?.open?.odds, a?.open?.moneyLine),
    mlHomeOpen: odds(o?.moneyline?.home?.open?.odds, h?.open?.moneyLine),
    mlAwayClose: odds(o?.moneyline?.away?.close?.odds, a?.close?.moneyLine, a?.moneyLine),
    mlHomeClose: odds(o?.moneyline?.home?.close?.odds, h?.close?.moneyLine, h?.moneyLine),
    plHomeOpenLine: line(o?.pointSpread?.home?.open?.line, h?.open?.pointSpread),
    plHomeOpenOdds: odds(o?.pointSpread?.home?.open?.odds, h?.open?.spread),
    plAwayOpenOdds: odds(o?.pointSpread?.away?.open?.odds, a?.open?.spread),
    plHomeCloseLine: line(o?.pointSpread?.home?.close?.line, h?.close?.pointSpread),
    plHomeCloseOdds: odds(o?.pointSpread?.home?.close?.odds, h?.close?.spread, h?.spreadOdds),
    plAwayCloseOdds: odds(o?.pointSpread?.away?.close?.odds, a?.close?.spread, a?.spreadOdds),
    totalOpenLine: line(o?.total?.over?.open?.line, o?.open?.total, o?.open?.overUnder),
    overOpenOdds: odds(o?.total?.over?.open?.odds, o?.open?.over),
    underOpenOdds: odds(o?.total?.under?.open?.odds, o?.open?.under),
    totalCloseLine: line(o?.total?.over?.close?.line, o?.close?.total, o?.close?.overUnder, o?.overUnder),
    overCloseOdds: odds(o?.total?.over?.close?.odds, o?.close?.over, o?.overOdds),
    underCloseOdds: odds(o?.total?.under?.close?.odds, o?.close?.under, o?.underOdds),
  };
}

/** Rows for a small batch of games (keep batches small: one ESPN request per game, more for $ref items). */
export async function fetchNhlOddsRows(
  games: NhlPastGame[],
  withRaw = false,
): Promise<{ rows: NhlOddsRow[]; failed: string[]; raw: string }> {
  const rows: NhlOddsRow[] = [];
  const failed: string[] = [];
  let raw = "";
  for (const game of games) {
    try {
      const json = await fetchJson(`${CORE}/events/${game.id}/competitions/${game.id}/odds?limit=50`);
      let items: any[] = Array.isArray(json?.items) ? json.items : [];
      const refs = items.filter((x) => x && typeof x.$ref === "string" && !x.provider);
      if (refs.length) {
        const resolved = await Promise.all(refs.slice(0, 6).map((x) => fetchJson(x.$ref).catch(() => null)));
        items = [...items.filter((x) => !(x && typeof x.$ref === "string" && !x.provider)), ...resolved.filter(Boolean)];
      }
      if (withRaw && !raw) raw = JSON.stringify({ odds: json, resolved: items }, null, 2).slice(0, 400_000);
      if (!items.length) {
        failed.push(game.id);
        continue;
      }
      for (const o of items) rows.push(oddsRow(game, o));
    } catch {
      failed.push(game.id);
    }
  }
  return { rows, failed, raw };
}
