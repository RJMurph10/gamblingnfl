/**
 * Server-only: ESPN's opening and closing NHL lines for past games, for the odds export page.
 *
 * Two small steps so no single request does too much work:
 *  1. fetchNhlSeasonEvents(season) lists a season's finished regular-season games (scoreboard, 10-day chunks).
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

/** Finished regular-season games of the season that starts in `season` (2023 = 2023-24). */
export async function fetchNhlSeasonEvents(season: number): Promise<NhlPastGame[]> {
  const start = new Date(season, 8, 25);
  const end = new Date(season + 1, 5, 30);
  const chunks: Array<[Date, Date]> = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 10)) {
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 9);
    chunks.push([new Date(d), to > end ? new Date(end) : to]);
  }
  const byId = new Map<string, NhlGame>();
  for (const [from, to] of chunks) {
    try {
      const json = await fetchJson(`${SITE}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=500`);
      for (const e of Array.isArray(json?.events) ? json.events : []) {
        const g = parseEvent(e);
        if (g && g.part === "reg" && g.status === "final") byId.set(g.id, g);
      }
    } catch (err) {
      console.error(`NHL odds export: scoreboard ${ymd(from)} failed`, err);
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((g) => ({
      id: g.id,
      date: g.date,
      away: g.away.team.abbr,
      home: g.home.team.abbr,
      awayScore: g.away.score,
      homeScore: g.home.score,
      detail: g.statusDetail,
    }));
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
