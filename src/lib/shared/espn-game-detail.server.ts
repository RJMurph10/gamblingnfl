/**
 * Server-only: one football game's full detail from ESPN (NFL and college): quarters, drives, team
 * stats, box score, play text and the spread/total win-probability lines.
 *
 * (Split out of the old lib/espn.server.ts; the code is unchanged.)
 */

import { nflverseGameYac } from "@/lib/nflverse-yac.server";
import { readFinal, writeFinal } from "@/lib/final-cache.server";
import type { BoxScoreLine, Drive, DriveResult, Game, TeamGameStats } from "@/data/games";
import { registerTeams, teamByAbbr, teamById } from "@/data/teams";
import { CORE_ODDS, FEEDS, HISTORICAL_ODDS_CACHE_TTL_MS, SEASON, SUMMARY, asProbability, cached, collegeTeamRefs, eventLeague, extractYacValue, fetchCoreProbabilityRecords, fetchHistoricalOdds, fetchJson, formatLocation, mapEvent, optionalNumber, parseGameInfo, parsePredictor, parseSeasonLeaders, parseTimeouts, prepareCollege, teamOf, weekScoreboardUrl } from "@/lib/shared/espn-core.server";
import { fetchTeamRoster } from "@/lib/shared/espn-teams-players.server";
import { addCollegeDetails } from "@/lib/cfb/cfb-espn.server";

const DRIVE_RESULTS: Record<string, DriveResult> = {
  TD: "TD",
  FG: "FG",
  PUNT: "PUNT",
  FUMBLE: "FUM",
  INTERCEPTION: "INT",
  DOWNS: "DOWNS",
  "END OF HALF": "EOH",
  "END OF GAME": "EOG",
};

function mapDriveResult(text: string | undefined): DriveResult {
  const key = (text ?? "").toUpperCase().trim();

  // ESPN uses human-readable drive results such as "Touchdown", "Field Goal",
  // "Punt", "Interception", and "End of Half". Match the full concepts first
  // instead of looking only for the abbreviation ("TOUCHDOWN" does not contain
  // the letters "TD").
  // A pick-six or fumble-return TD is a turnover for the offense, not a TD,
  // so check for turnover wording before the touchdown label.
  if (key.includes("INTERCEPTION") || /\bINT\b/.test(key)) return "INT";
  if (key.includes("FUMBLE") || /\bFUM\b/.test(key)) return "FUM";
  if (key.includes("TOUCHDOWN") || key === "TD") return "TD";
  if (key.includes("FIELD GOAL") || key === "FG") return "FG";
  if (key.includes("DOWNS") || key.includes("TURNOVER ON DOWNS")) return "DOWNS";
  if (key.includes("END OF HALF")) return "EOH";
  if (key.includes("END OF GAME")) return "EOG";
  if (key.includes("PUNT")) return "PUNT";

  for (const [k, v] of Object.entries(DRIVE_RESULTS)) {
    if (key.includes(k)) return v;
  }
  return "PUNT";
}

/**
 * ESPN sometimes labels a drive "TD" when the offense turned the ball over and
 * the defense scored (pick-six or fumble return). Look at the drive's final
 * play: if it was an interception or a fumble recovered by the other team and
 * ended in a touchdown, report INT or FUM instead of TD.
 */
function refineTurnoverTd(
  result: DriveResult,
  drive: any,
  driveTeamAbbr: string | undefined,
): DriveResult {
  if (result !== "TD") return result;
  const plays: any[] = Array.isArray(drive?.plays) ? drive.plays : [];
  const last = plays[plays.length - 1];
  if (!last) return result;
  const text = `${last?.text ?? ""} ${last?.shortText ?? ""} ${last?.type?.text ?? ""}`;
  if (!/touchdown/i.test(text)) return result;
  if (/intercept/i.test(text)) return "INT";
  if (/fumble/i.test(text)) {
    // If the drive team itself recovered and scored, it is still a normal TD.
    const recovered = text.match(/recovered by\s+([A-Z]{2,4})-/i)?.[1]?.toUpperCase();
    if (recovered && driveTeamAbbr && recovered === driveTeamAbbr.toUpperCase()) return result;
    return "FUM";
  }
  return result;
}

function statNum(stats: any[], name: string): number {
  const s = stats.find((x: any) => x.name === name);
  return s ? Number(String(s.displayValue).replace(/,/g, "")) || 0 : 0;
}

/** Looks up one team-stat by any of several possible ESPN names. */
function findStat(stats: any[], ...names: string[]): any {
  for (const n of names) {
    const hit = stats.find((x: any) => x?.name === n);
    if (hit) return hit;
  }
  return undefined;
}

/** "5-12" (or "5/12") -> [5, 12]. */
export function parsePair(text: unknown): [number, number] {
  const m = String(text ?? "").match(/(\d+)\s*[-/]\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

function mapTeamStats(stats: any[]): TeamGameStats {
  const [thirdMade, thirdAtt] = parsePair(findStat(stats, "thirdDownEff")?.displayValue);
  const [fourthMade, fourthAtt] = parsePair(findStat(stats, "fourthDownEff")?.displayValue);
  const [rzMade, rzAtt] = parsePair(findStat(stats, "redZoneAttempts", "redZoneEff")?.displayValue);
  // "5-45" = 5 penalties for 45 yards (a bare "5" means no yardage given)
  const penText = String(findStat(stats, "totalPenaltiesYards", "penalties")?.displayValue ?? "");
  const hasPair = /\d+\s*[-/]\s*\d+/.test(penText);
  const [pairCount, penaltyYards] = parsePair(penText);
  const penalties = hasPair ? pairCount : Number(penText) || 0;
  return {
    totalYards: statNum(stats, "totalYards"),
    passYards: statNum(stats, "netPassingYards"),
    rushYards: statNum(stats, "rushingYards"),
    firstDowns: statNum(stats, "firstDowns"),
    thirdDownPct: thirdAtt > 0 ? Math.round((thirdMade / thirdAtt) * 100) : 0,
    thirdDownMade: thirdMade,
    thirdDownAtt: thirdAtt,
    fourthDownMade: fourthMade,
    fourthDownAtt: fourthAtt,
    redZoneMade: rzMade,
    redZoneAtt: rzAtt,
    turnovers: statNum(stats, "turnovers"),
    penalties,
    penaltyYards,
    timeOfPossession: stats.find((x: any) => x.name === "possessionTime")?.displayValue ?? "00:00",
  };
}

/**
 * Adds the stats ESPN only publishes per player (touchdowns, field goals,
 * extra points, sacks, defensive stats...) by summing each team's player
 * blocks. Anything ESPN doesn't provide stays 0, and the comparison hides
 * stats nobody recorded, so a missing field never shows a wrong number.
 */
function addPlayerTotals(
  stats: TeamGameStats,
  teamBlock: any,
  teamTotals: { defTdFromTeamStat: number },
): void {
  const groups: any[] = teamBlock?.statistics ?? [];
  const sumKey = (groupNames: string[], ...keyNames: string[]): number => {
    let total = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const keys: string[] = g.keys ?? [];
      const idx = keyNames.map((k) => keys.indexOf(k)).find((i) => i >= 0);
      if (idx === undefined) continue;
      for (const a of g.athletes ?? []) {
        total += Number(String(a?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      }
    }
    return total;
  };
  const sumPair = (groupNames: string[], keyName: string): [number, number] => {
    let made = 0;
    let att = 0;
    for (const g of groups) {
      if (!groupNames.includes(g?.name)) continue;
      const idx = (g.keys ?? []).indexOf(keyName);
      if (idx < 0) continue;
      for (const a of g.athletes ?? []) {
        const [m, t] = parsePair(a?.stats?.[idx]);
        made += m;
        att += t;
      }
    }
    return [made, att];
  };

  const passTd = sumKey(["passing"], "passingTouchdowns");
  const rushTd = sumKey(["rushing"], "rushingTouchdowns");
  // Defensive TDs can be reported in more than one place; take the highest
  // figure rather than adding them, so nothing is ever double counted.
  const defTd = Math.max(
    sumKey(["defensive"], "defensiveTouchdowns"),
    sumKey(["interceptions"], "interceptionTouchdowns"),
    teamTotals.defTdFromTeamStat,
  );
  const returnTd =
    sumKey(["kickReturns"], "kickReturnTouchdowns") +
    sumKey(["puntReturns"], "puntReturnTouchdowns");
  const [fgMade, fgAtt] = sumPair(["kicking"], "fieldGoalsMade/fieldGoalAttempts");
  const [xpMade, xpAtt] = sumPair(["kicking"], "extraPointsMade/extraPointAttempts");

  stats.passingTouchdowns = passTd;
  stats.rushingTouchdowns = rushTd;
  stats.defensiveTouchdowns = defTd;
  stats.touchdowns = passTd + rushTd + defTd + returnTd;
  stats.fieldGoalsMade = fgMade;
  stats.fieldGoalAttempts = fgAtt;
  stats.extraPointsMade = xpMade;
  stats.extraPointAttempts = xpAtt;
  stats.sacks = sumKey(["defensive"], "sacks");
  stats.tacklesForLoss = sumKey(["defensive"], "tacklesForLoss");
  stats.passesDefended = sumKey(["defensive"], "passesDefended");
  stats.qbHits = sumKey(["defensive"], "QBHits", "qbHits");
  stats.interceptions = Math.max(
    sumKey(["interceptions"], "interceptions", "interceptionsThrown"),
    sumKey(["defensive"], "interceptions", "interceptionsThrown"),
  );

  // ESPN has used different group/key names for forced fumbles across feeds.
  // Search all defensive/fumble-related groups and key aliases rather than
  // assuming the field always lives under the exact `defensive` group.
  const forcedFumbleKeys = ["forcedFumbles", "fumblesForced", "forcedFumble", "FF"];
  let forcedFumbles = 0;
  const seenAthletes = new Map<string, number>();
  for (const group of groups) {
    const groupName = String(group?.name ?? "").toLowerCase();
    if (!/(defens|fumble|interception)/.test(groupName)) continue;
    const keys: string[] = group.keys ?? [];
    const idx = forcedFumbleKeys.map((key) => keys.indexOf(key)).find((i) => i >= 0);
    if (idx === undefined) continue;
    for (const [athleteIndex, athlete] of (group.athletes ?? []).entries()) {
      const value = Number(String(athlete?.stats?.[idx] ?? "0").replace(/,/g, "")) || 0;
      const athleteId = String(
        athlete?.athlete?.id ??
          athlete?.id ??
          athlete?.athlete?.displayName ??
          athlete?.displayName ??
          `${groupName}-${athleteIndex}`,
      );
      // Some ESPN feeds repeat a defender in multiple groups. Keep the largest
      // value for that player instead of double-counting the same forced fumble.
      seenAthletes.set(athleteId, Math.max(seenAthletes.get(athleteId) ?? 0, value));
    }
  }
  forcedFumbles = [...seenAthletes.values()].reduce((total, value) => total + value, 0);
  stats.forcedFumbles = forcedFumbles;
}

function mapBoxScore(
  players: any[],
  awayTeamId: string,
  homeTeamId: string,
  posMap?: Map<string, string>,
): BoxScoreLine[] {
  const lines: BoxScoreLine[] = [];
  const wanted = new Set([
    "passing",
    "rushing",
    "receiving",
    "defensive",
    "interceptions",
    "fumbles",
    "kicking",
    "punting",
  ]);
  // Every raw stat ESPN reports for a player, across all of their groups (used for the RB table).
  const rawStats = new Map<string, Record<string, string>>();

  for (const teamBlock of players ?? []) {
    const teamId = teamOf(teamBlock?.team)?.id;
    if (!teamId || (teamId !== awayTeamId && teamId !== homeTeamId)) continue;

    for (const group of teamBlock?.statistics ?? []) {
      if (!wanted.has(group?.name)) continue;

      for (const athlete of group?.athletes ?? []) {
        if (!athlete?.athlete?.displayName) continue;
        const ath = athlete.athlete;
        const keys: string[] = group.keys ?? [];
        const vals: string[] = athlete.stats ?? [];

        const getVal = (name: string) => {
          const idx = keys.indexOf(name);
          return idx >= 0 ? vals[idx] : undefined;
        };
        // Remember each raw value so the page can show detailed columns (CAR, RUYDS, TGT, FL, ...).
        const rawKey = `${teamId}:${ath.id ?? String(ath.displayName).toLowerCase()}`;
        const rawForPlayer = rawStats.get(rawKey) ?? {};
        keys.forEach((key, index) => {
          if (vals[index] !== undefined) {
            rawForPlayer[key] = String(vals[index]);
            if (group.name === "passing" && /sack/i.test(key)) {
              // ESPN may provide a combined "sacks-sackedYards" value such as "2-14".
              const match = String(vals[index]).match(/^\s*(\d+)/);
              rawForPlayer.sacks = match ? match[1] : String(Number(vals[index]) || 0);
            }
          }
        });
        rawStats.set(rawKey, rawForPlayer);
        // The fumbles group only supplies extra numbers; it never creates a player row on its own.
        if (group.name === "fumbles") continue;
        const pick = (...names: string[]) => names.map(getVal).filter(Boolean).join(", ");

        let statLine = "";
        let category: "offense" | "defense" = "offense";

        if (group.name === "passing") {
          statLine = `${pick("completions/passingAttempts")}, ${pick("passingYards")} yds, ${pick("passingTouchdowns")} TD, ${pick("interceptions")} INT`;
          category = "offense";
        } else if (group.name === "rushing") {
          statLine = `${pick("rushingAttempts")} car, ${pick("rushingYards")} yds, ${pick("rushingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "receiving") {
          statLine = `${pick("receptions")} rec, ${pick("receivingYards")} yds, ${pick("receivingTouchdowns")} TD`;
          category = "offense";
        } else if (group.name === "kicking") {
          statLine = `${pick("fieldGoalsMade/fieldGoalAttempts")} FG, ${pick("extraPointsMade/extraPointAttempts")} XP`;
          category = "offense";
        } else if (group.name === "defensive") {
          const tkl = getVal("totalTackles") ?? "0";
          const solo = getVal("soloTackles");
          const sck = getVal("sacks");
          const pd = getVal("passesDefended");
          const tfl = getVal("tacklesForLoss");
          const parts: string[] = [];
          if (tkl && tkl !== "0")
            parts.push(`${tkl} tkl${solo && solo !== "0" ? ` (${solo} solo)` : ""}`);
          if (sck && sck !== "0") parts.push(`${sck} sck`);
          if (pd && pd !== "0") parts.push(`${pd} PD`);
          if (tfl && tfl !== "0") parts.push(`${tfl} TFL`);
          statLine = parts.join(", ") || `${tkl} tkl`;
          category = "defense";
        } else if (group.name === "interceptions") {
          const intCount = getVal("interceptions") ?? "1";
          const intYds = getVal("interceptionYards");
          const intTd = getVal("interceptionTouchdowns");
          const parts = [`${intCount} INT`];
          if (intYds && intYds !== "0") parts.push(`${intYds} yds`);
          if (intTd && intTd !== "0") parts.push(`${intTd} TD`);
          statLine = parts.join(", ");
          category = "defense";
        }

        // Look up condensed position in roster posMap or fall back to condensed shorthand
        const athId = String(ath.id ?? "");
        const athName = (ath.displayName ?? "").toLowerCase();
        let pos =
          ath.position?.abbreviation ||
          posMap?.get(athId) ||
          posMap?.get(athName) ||
          (group.name === "passing"
            ? "QB"
            : group.name === "rushing"
              ? "RB"
              : group.name === "receiving"
                ? "WR"
                : group.name === "defensive"
                  ? "DEF"
                  : group.name === "interceptions"
                    ? "DB"
                    : group.name === "kicking"
                      ? "K"
                      : group.name === "punting"
                        ? "P"
                        : "ATH");

        pos = pos.toUpperCase();
        if (pos === "PASSING") pos = "QB";
        if (pos === "RUSHING") pos = "RB";
        if (pos === "RECEIVING") pos = "WR";
        if (pos === "DEFENSIVE") pos = "DEF";
        // ESPN commonly labels placekickers as PK; normalize them so the
        // frontend renders the dedicated kicker table rather than the generic row.
        if (pos === "PK" || pos === "PLACEKICKER" || pos === "KICKER") pos = "K";
        if (pos === "PUNTER") pos = "P";

        // Offensive skill players belong on the offense tab even when ESPN also
        // reports defensive stats for them. Keep their defensive stat line below
        // by merging the records, but never let the defensive group move them
        // into the defense category.
        const isOffensiveSkillPosition =
          ["QB", "RB", "FB", "WR", "TE", "K", "P"].includes(pos) ||
          group.name === "kicking" ||
          group.name === "punting";
        if (isOffensiveSkillPosition) category = "offense";

        lines.push({
          playerId: ath.id ? String(ath.id) : undefined,
          jersey: String(ath.jersey ?? athlete?.jersey ?? "").trim() || undefined,
          name: ath.displayName,
          position: pos,
          teamId,
          statLine,
          category,
        });
      }
    }
  }
  for (const line of lines) {
    const raw = rawStats.get(`${line.teamId}:${line.playerId ?? line.name.toLowerCase()}`);
    if (raw) line.stats = raw;
  }

  // ESPN exposes one athlete in multiple groups (for example, a QB in
  // passing + rushing or an RB in rushing + receiving). Collapse those
  // records into one player row so a player is never listed twice.
  const merged = new Map<string, BoxScoreLine>();
  for (const line of lines) {
    const key = `${line.teamId}:${line.playerId ?? line.name.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line });
      continue;
    }

    const statParts = existing.statLine.split(" · ").filter(Boolean);
    if (line.statLine && !statParts.includes(line.statLine)) {
      statParts.push(line.statLine);
    }
    existing.statLine = statParts.join(" · ");
    if (!existing.jersey && line.jersey) existing.jersey = line.jersey;

    // Offensive skill positions always remain on the offense tab, even when
    // the same player has tackles, sacks, or other defensive stats. Their
    // defensive stat line is still merged above and retained in the box score.
    const offensivePositions = ["QB", "RB", "FB", "WR", "TE", "K", "P"];
    if (
      offensivePositions.includes(existing.position.toUpperCase()) ||
      offensivePositions.includes(line.position.toUpperCase())
    ) {
      existing.category = "offense";
      if (
        !offensivePositions.includes(existing.position.toUpperCase()) &&
        offensivePositions.includes(line.position.toUpperCase())
      ) {
        existing.position = line.position;
      }
    } else if (line.category === "defense") {
      existing.category = "defense";
    }
  }

  return Array.from(merged.values());
}

/* ---------- spread / total probability model ---------- */

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation of the standard normal CDF.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-z * z)));
}

function normalInverse(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Home team's handicap from a string like "SEA -3.5" (negative = home favored). */
function homeSpreadFromLine(spread: string, game: Game): number | undefined {
  if (!spread || spread === "—") return undefined;
  if (/^(pk|pick|even|ev)\b/i.test(spread.trim())) return 0;
  const match = spread.match(/^([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const alias: Record<string, string> = { LA: "LAR", WAS: "WSH", JAC: "JAX" };
  const abbr = alias[match[1].toUpperCase()] ?? match[1].toUpperCase();
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return undefined;
  // Match the game's own teams first (college abbreviations clash with NFL ones).
  const favoriteId =
    [game.homeTeamId, game.awayTeamId].find((id) => teamById(id)?.abbr.toUpperCase() === abbr) ??
    teamByAbbr(abbr)?.id;
  if (favoriteId === game.homeTeamId) return -Math.abs(line);
  if (favoriteId === game.awayTeamId) return Math.abs(line);
  return undefined;
}

function hasRealSeries(
  points: NonNullable<Game["probabilities"]>,
  key: "homeCoverProbability" | "overProbability",
) {
  const numeric = points.map((p) => p[key]).filter((v): v is number => typeof v === "number");
  // Needs data for most plays, many distinct values and real movement. ESPN's real series
  // legitimately sit at 0 or 1 late in a game; placeholder series are flat (0 or 0.5).
  if (numeric.length < Math.max(8, points.length * 0.6)) return false;
  const distinct = new Set(numeric.map((v) => v.toFixed(3))).size;
  const range = Math.max(...numeric) - Math.min(...numeric);
  return distinct >= 8 && range > 0.05;
}

/** Fill plays that ESPN left out by carrying the nearest known value across the gap. */
function fillSeriesGaps(
  points: NonNullable<Game["probabilities"]>,
  key: "homeCoverProbability" | "overProbability",
) {
  let last: number | undefined;
  for (const point of points) {
    if (typeof point[key] === "number") last = point[key];
    else if (last !== undefined) point[key] = last;
  }
  const first = points.find((p) => typeof p[key] === "number")?.[key];
  if (first !== undefined) {
    for (const point of points) {
      if (typeof point[key] === "number") break;
      point[key] = first;
    }
  }
}

function withMarketProbabilities(
  inputPoints: NonNullable<Game["probabilities"]>,
  game: Game,
): NonNullable<Game["probabilities"]> {
  let input = inputPoints;
  const useRealCover = hasRealSeries(input, "homeCoverProbability");
  const useRealOver = hasRealSeries(input, "overProbability");
  if (useRealCover || useRealOver) {
    input = input.map((point) => ({ ...point }));
    for (const [real, key] of [
      [useRealCover, "homeCoverProbability"],
      [useRealOver, "overProbability"],
    ] as const) {
      if (!real) continue;
      fillSeriesGaps(input, key);
      // ESPN's first record is a 50/50 pregame placeholder; its graph starts at the next value.
      if (input.length > 1 && input[0][key] === 0.5 && input[1][key] !== 0.5)
        input[0][key] = input[1][key];
    }
  }
  const homeSpread = homeSpreadFromLine(game.spread, game);
  const totalLine = game.total > 0 ? game.total : undefined;
  const count = input.length;

  let lastAway: number | undefined;
  let lastHome: number | undefined;
  // Once the combined score clears the total line, Over is mathematically locked.
  // Latch that state chronologically so stale/missing score snapshots cannot make
  // the Total curve flip back to Under later in the game.
  const overResolved: boolean[] = [];
  let totalAlreadyOver = false;
  const out = input.map((point, index) => {
    // Scores only ever go up; ignore stale or out-of-order values from play matching.
    if (typeof point.awayScore === "number") lastAway = Math.max(lastAway ?? 0, point.awayScore);
    if (typeof point.homeScore === "number") lastHome = Math.max(lastHome ?? 0, point.homeScore);
    const next = { ...point };
    const estimatedMarkets: ("cover" | "over")[] = [];

    // Fraction of regulation remaining; fall back to even spacing if ESPN omits secondsLeft.
    const rawFraction =
      typeof point.secondsLeft === "number"
        ? point.secondsLeft / 3600
        : 1 - index / Math.max(1, count - 1);
    // Overtime is sudden death-ish: never treat it as "almost over" for the variance.
    const inOvertime = typeof point.quarter === "number" && point.quarter > 4;
    const fraction = Math.max(inOvertime ? 0.06 : 0.01, Math.min(1, rawFraction));

    if (!useRealCover) {
      next.homeCoverProbability = undefined;
      if (homeSpread !== undefined) {
        const sigma = 13.5 * Math.sqrt(fraction);
        const hasWinProbability = typeof point.homeWinProbability === "number";
        const hasScore = lastAway !== undefined && lastHome !== undefined;
        // Expected final margin implied by ESPN's win probability: smooth, like the moneyline graph.
        const p = hasWinProbability
          ? Math.max(0.0005, Math.min(0.9995, point.homeWinProbability as number))
          : undefined;
        const muFromWinProbability = p !== undefined ? sigma * normalInverse(p) : undefined;
        // Expected final margin from the actual score plus the pregame edge for the time left.
        const muFromScore = hasScore ? lastHome! - lastAway! + fraction * -homeSpread : undefined;
        let mu: number | undefined;
        if (muFromWinProbability !== undefined && muFromScore !== undefined && p !== undefined) {
          // Win probability saturates near 0/1 (a 21-point lead looks like "99.9%"), which would
          // understate the margin, so fade to the real score margin only at the extremes.
          const weightScore = Math.max(0, Math.min(1, (Math.abs(p - 0.5) - 0.35) / 0.14));
          mu = (1 - weightScore) * muFromWinProbability + weightScore * muFromScore;
        } else {
          mu = muFromWinProbability ?? muFromScore;
        }
        if (mu !== undefined) {
          next.homeCoverProbability = normalCdf((mu + homeSpread) / sigma);
          estimatedMarkets.push("cover");
        }
      }
    }
    if (!useRealOver) {
      next.overProbability = undefined;
      if (totalLine !== undefined && lastAway !== undefined && lastHome !== undefined) {
        const sigma = 13 * Math.sqrt(fraction);
        // Remaining points: mostly the pregame total's pace, nudged toward the pace seen so far.
        const scoredSoFar = lastAway + lastHome;
        if (scoredSoFar > totalLine) totalAlreadyOver = true;
        overResolved[index] = totalAlreadyOver;
        const playedFraction = 1 - fraction;
        const observedRate = playedFraction > 0.15 ? scoredSoFar / playedFraction : totalLine;
        const blendedRate =
          playedFraction > 0.15 ? 0.75 * totalLine + 0.25 * observedRate : totalLine;
        const expectedFinal = scoredSoFar + blendedRate * fraction;
        next.overProbability = totalAlreadyOver
          ? 1
          : 1 - normalCdf((totalLine - expectedFinal) / sigma);
        estimatedMarkets.push("over");
      }
    }
    // Late-game total safeguard: when the score is at most two points below
    // the posted total with two minutes or less remaining, the Over is highly
    // favored because even a safety clears many half-point totals. ESPN's
    // public feed can contain stale/placeholder total probabilities (including
    // 0% Over); do not let those values display as 100% Under in this situation.
    const currentTotal =
      lastAway !== undefined && lastHome !== undefined ? lastAway + lastHome : undefined;
    const secondsRemaining =
      typeof point.secondsLeft === "number"
        ? point.secondsLeft
        : typeof point.quarter === "number" && typeof point.clock === "string"
          ? (() => {
              const m = point.clock.match(/(\d+):([0-5]\d)/);
              return m
                ? (point.quarter < 4 ? (4 - point.quarter) * 900 : 0) +
                    Number(m[1]) * 60 +
                    Number(m[2])
                : undefined;
            })()
          : undefined;
    if (totalLine !== undefined && currentTotal !== undefined) {
      if (currentTotal > totalLine) {
        // Once the points already scored exceed the total, the Over is locked.
        next.overProbability = 1;
        totalAlreadyOver = true;
        overResolved[index] = true;
      } else {
        // Never show 100% Over before the total has actually been exceeded.
        // Numerical CDF rounding and stale ESPN market samples can otherwise
        // produce 1.0 while the game is still mathematically able to finish Under.
        if (typeof next.overProbability === "number" && next.overProbability > 0.99) {
          next.overProbability = 0.99;
          if (!estimatedMarkets.includes("over")) estimatedMarkets.push("over");
        }
        if (
          totalLine - currentTotal <= 2 &&
          secondsRemaining !== undefined &&
          secondsRemaining > 0 &&
          secondsRemaining <= 120
        ) {
          // At this point, a score within two points of the total late in the
          // fourth quarter should not inherit a stale ESPN 0% Over / 100% Under.
          // Keep the estimate at 99% Over, while never claiming certainty.
          next.overProbability = 0.99;
          if (!estimatedMarkets.includes("over")) estimatedMarkets.push("over");
        }
      }
    }

    next.estimatedMarkets = estimatedMarkets.length ? estimatedMarkets : undefined;
    next.probabilitySource = estimatedMarkets.length
      ? "estimated"
      : useRealCover || useRealOver
        ? "espn"
        : undefined;
    return next;
  });

  // Finished games: the last sample resolves to the actual result against the line.
  // Smooth the estimated series so they move like ESPN's moneyline curve instead of
  // jumping at every scoring play (centered moving average; endpoints stay untouched).
  const smooth = (key: "homeCoverProbability" | "overProbability") => {
    const raw = out.map((point) => point[key]);
    const radius = 3;
    out.forEach((point, i) => {
      const value = raw[i];
      if (typeof value !== "number" || i === 0 || i === out.length - 1) return;
      let sum = 0;
      let weight = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(out.length - 1, i + radius); j++) {
        const neighbor = raw[j];
        if (typeof neighbor !== "number") continue;
        const w = radius + 1 - Math.abs(j - i);
        sum += neighbor * w;
        weight += w;
      }
      if (weight > 0) point[key] = sum / weight;
    });
  };
  if (!useRealCover) smooth("homeCoverProbability");
  if (!useRealOver) {
    smooth("overProbability");
    out.forEach((point, i) => {
      if (overResolved[i]) point.overProbability = 1;
    });
  }
  // Reapply the late-game near-total rule after smoothing; the final displayed
  // series must not revert to 100% Under from a stale ESPN probability sample.
  out.forEach((point) => {
    const scoreTotal =
      typeof point.awayScore === "number" && typeof point.homeScore === "number"
        ? point.awayScore + point.homeScore
        : undefined;
    const remaining = typeof point.secondsLeft === "number" ? point.secondsLeft : undefined;
    if (totalLine !== undefined && scoreTotal !== undefined) {
      if (scoreTotal > totalLine) {
        // A score above the line makes Over certain, including after smoothing.
        point.overProbability = 1;
      } else {
        // The probability must remain below 100% until the score itself clears
        // the line. Apply this after smoothing too, so it cannot reintroduce 1.0.
        if (typeof point.overProbability === "number" && point.overProbability > 0.99) {
          point.overProbability = 0.99;
          point.estimatedMarkets = [
            ...(point.estimatedMarkets ?? []),
            ...(point.estimatedMarkets?.includes("over") ? [] : ["over" as const]),
          ];
          point.probabilitySource = "estimated";
        }
        if (
          scoreTotal <= totalLine &&
          totalLine - scoreTotal <= 2 &&
          remaining !== undefined &&
          remaining > 0 &&
          remaining <= 120
        ) {
          // Reapply after smoothing; do not preserve a stale 0% Over estimate.
          point.overProbability = 0.99;
          point.estimatedMarkets = [
            ...(point.estimatedMarkets ?? []),
            ...(point.estimatedMarkets?.includes("over") ? [] : ["over" as const]),
          ];
          point.probabilitySource = "estimated";
        }
      }
    }
  });

  const sumQuarters = (values?: number[]) =>
    Array.isArray(values) ? values.reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const officialAway = sumQuarters(game.quarters?.away);
  const officialHome = sumQuarters(game.quarters?.home);
  if (game.status === "final" && out.length) {
    // Use the official final score, not whatever the last matched play carried.
    const finalAway = officialAway + officialHome > 0 ? officialAway : lastAway;
    const finalHome = officialAway + officialHome > 0 ? officialHome : lastHome;
    if (finalAway !== undefined && finalHome !== undefined) {
      const last = out[out.length - 1];
      last.awayScore = finalAway;
      last.homeScore = finalHome;
      if (!useRealCover && homeSpread !== undefined) {
        const diff = finalHome - finalAway + homeSpread;
        last.homeCoverProbability = diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
      }
      if (!useRealOver && totalLine !== undefined) {
        const total = finalAway + finalHome;
        last.overProbability = total > totalLine ? 1 : total < totalLine ? 0 : 0.5;
      }
    }
  }
  return out;
}
/**
 * Formats live rushing play descriptions to "[Player] [yardage] rush",
 * formats rushing touchdowns to "[Player] [yardage] TD run" with the PAT on the next line,
 * and strips eligibility notes, direct snap notes, and Center/Holder credits.
 */
function formatRushingPlay(text: string): string {
  // Check for rushing touchdowns (excluding passing and turnover plays)
  if (
    /\b(?:touchdown|td)\b/i.test(text) &&
    !/\b(?:pass|passed|sacked|interception|intercepted)\b/i.test(text)
  ) {
    // 1. Strip pre-play notes (e.g. "A.Palczewski reported in as eligible." and "Direct snap to R.Harvey.")
    let cleaned = text
      .replace(/^[A-Z]\.[A-Za-z'-]+\s+reported\s+in\s+as\s+eligible\.?\s*/i, "")
      .replace(/^Direct\s+snap\s+to\s+[A-Z]\.[A-Za-z'-]+\.?\s*/i, "")
      .trim();

    // 2. Strip Center and Holder personnel credits
    cleaned = cleaned.replace(/,?\s*(?:Center|Holder)-[A-Z]\.[A-Za-z'-]+/gi, "").trim();

    // 3. Match "[Player] [direction] for [X yards], TOUCHDOWN. [PAT text]"
    const tdMatch = cleaned.match(
      /^(.*?)\s+(?:(?:right|left)\s+(?:tackle|guard|end)|up\s+the\s+middle|middle|rush(?:es)?)\s+for\s+(no gain|loss of \d+\s*(?:yards?|yds?)|-?\d+\s*(?:yards?|yds?))\s*,\s*(?:TOUCHDOWN|TD)\.?(?:\s*(.*))?$/i,
    );

    if (tdMatch) {
      const player = tdMatch[1].trim();
      const yards = tdMatch[2].trim().replace(/\byards\b/i, "yard");
      const pat = tdMatch[3]?.trim().replace(/\.+$/, "");
      const tdLine = `${player} ${yards} TD run.`;
      return pat ? `${tdLine}\n${pat}.` : tdLine;
    }
  }

  // Preserve other play types (passing, penalties, field goals, etc.)
  if (
    /\b(?:touchdown|td|pass|passed|sacked|penalty|kneel|spike|punt|field goal|fg|kickoff|extra point)\b/i.test(
      text,
    )
  ) {
    return text;
  }

  const match = text.match(
    /^(.*?)\s+(?:(?:right|left)\s+(?:tackle|guard|end)|up\s+the\s+middle|middle|rush(?:es)?)\s+for\s+(no gain|loss of \d+\s*(?:yards?|yds?)|-?\d+\s*(?:yards?|yds?))(?:\s*,\s*|\s*)(.*)$/i,
  );
  if (!match) return text;

  const player = match[1].trim();
  const yards = match[2].trim().replace(/\byards\b/i, "yard");
  const rest = match[3]?.trim().replace(/\.+$/, "") ?? "";
  const dot = text.endsWith(".") ? "." : "";
  return rest ? `${player} ${yards} rush ${rest}${dot}` : `${player} ${yards} rush${dot}`;
}

/**
 * Formats completed passing yard plays by removing directional indicators
 * ("short right", "deep left", "short middle", etc.) while leaving touchdowns untouched.
 */
/**
 * Made field goals: "M.Gay 27 yard field goal is GOOD, Center-A.Ward, Holder-A.Cole." becomes
 * "M.Gay 27 yard field goal". Missed field goals and everything else keep their original text.
 */
function formatMadeFieldGoal(text: string): string {
  const match = text.match(/^(.*?\b\d{1,2}\s*(?:-?\s*yard|yd|yds)\s+field goal)\s+is\s+good\b/i);
  return match ? match[1].trim() : text;
}

/**
 * Incomplete passes: "S.Darnold pass incomplete short left to A.Barner [M.Roach]." becomes
 * "S.Darnold pass incomplete to A.Barner." The bracketed pass defender is kept as data
 * (returned separately) but not shown in the play text.
 */
function formatIncompletePass(text: string): { text: string; defender?: string } {
  if (!/\bpass\s+incomplete\b/i.test(text) || /\bintercept/i.test(text)) return { text };
  const defender = text.match(/\[([^\]]+)\]/)?.[1]?.trim();
  const cleaned = text
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(
      /\bpass\s+incomplete(?:\s+(?:short|deep|intermediate))?(?:\s+(?:left|right|middle))?/i,
      "pass incomplete",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
  return { text: cleaned, defender };
}

function formatPassingPlay(text: string): string {
  if (!/\bpass\b/i.test(text)) return text;

  return text
    .replace(/\bpass\s+(?:short|deep|intermediate)\s+(?:right|left|middle)\s+to\b/gi, "pass to")
    .replace(/\bpass\s+(?:short|deep|intermediate)\s+(?:right|left|middle)\b/gi, "pass");
}

/**
 * Completed passes: "[M.Crosby]" is the credited pass defender. Remove it from the shown text
 * and return it separately so the data is kept.
 */
function stripPassDefender(text: string): { text: string; defender?: string } {
  if (!/\bpass\b/i.test(text)) return { text };
  const defender = text.match(/\[([^\]]+)\]/)?.[1]?.trim();
  if (!defender) return { text };
  return {
    text: text
      .replace(/\s*\[[^\]]*\]/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;])/g, "$1")
      .trim(),
    defender,
  };
}

/** Extra points: "T.Bass extra point is GOOD, Center-R.Ferguson, Holder-T.Doman." -> "T.Bass extra point is GOOD." */
function formatExtraPoint(text: string): string {
  // Player names contain periods ("R.Ferguson"), so cut ", Center-..." / ", Holder-..." segments by name.
  return text.replace(
    /(\bextra point is good)(?:\s*,\s*(?:Center|Holder|Long Snapper)-[^,]+?(?=\s*,\s*(?:Center|Holder|Long Snapper)-|\.\s*$|\.\s+[A-Z]\.[A-Za-z]|$))+/gi,
    "$1",
  );
}

/** Full game detail (quarters, drives, team stats, box score) for one event. */
export async function fetchGameDetail(rawEventId: string): Promise<Game | null> {
  // College games come in as "cfb-<id>"; everything else is an NFL ESPN id.
  const { league, id: eventId } = eventLeague(rawEventId);
  // A game that finished over a day ago (late stat updates included) is kept long-term.
  const storeKey = `game-detail-${league}-${eventId}`;
  const stored = await readFinal<Game>(storeKey);
  if (stored) {
    if (stored.teamRefs) registerTeams(stored.teamRefs);
    return stored;
  }
  const game = await loadGameDetail(league, eventId);
  const kickoff = game?.kickoffIso ? new Date(game.kickoffIso).getTime() : NaN;
  if (game && game.status === "final" && Number.isFinite(kickoff) && Date.now() - kickoff > 36 * 3_600_000) {
    await writeFinal(storeKey, game);
  }
  return game;
}

async function loadGameDetail(league: ReturnType<typeof eventLeague>["league"], eventId: string): Promise<Game | null> {
  const college = league === "cfb";
  const SUMMARY = FEEDS[league].summary;
  const game = await cached(`game-${league}-${eventId}`, async (): Promise<Game | null> => {
    const d = await fetchJson(`${SUMMARY}?event=${eventId}`);
    if (college) prepareCollege(d);
    // Resolve ESPN Core API probability records; items may be $ref-only.
    const coreProbabilityItems = await fetchCoreProbabilityRecords(eventId, league);
    const comp = d?.header?.competitions?.[0];
    if (!comp) return null;
    const week = d?.header?.week ?? 0;
    const base = mapEvent(
      { id: eventId, date: comp.date ?? d?.header?.date, competitions: [comp] },
      week,
    );
    if (!base) return null;
    if (college) {
      base.id = `cfb-${eventId}`;
      addCollegeDetails(base, comp);
    }

    const summaryProbabilities = Array.isArray(d?.winprobability) ? d.winprobability : [];
    const summaryPlays = [
      ...[
        ...(Array.isArray(d?.drives?.previous) ? d.drives.previous : []),
        ...(d?.drives?.current ? [d.drives.current] : []),
      ].flatMap((drive: any) => (Array.isArray(drive?.plays) ? drive.plays : [])),
      ...(Array.isArray(d?.plays) ? d.plays : []),
    ];

    // Keep ESPN's summary win-probability history as the canonical timeline.
    // The Core API collection can contain a different number/order of records;
    // merging both arrays by index creates mismatched plays and a misleading
    // Moneyline curve. Join market fields by play ID only, never by array index.
    // ESPN's records carry no playId field: the play is only named in their $ref URLs
    // (".../plays/<id>" and ".../probabilities/<id>"), so read the id from there.
    const refId = (ref: unknown): string | undefined =>
      typeof ref === "string" ? /\/(?:plays|probabilities)\/(\d+)/.exec(ref)?.[1] : undefined;
    const coreByPlayId = new Map<string, any>();
    for (const record of coreProbabilityItems) {
      const id = String(
        record?.playId ??
          record?.play?.id ??
          refId(record?.play?.$ref) ??
          refId(record?.$ref) ??
          "",
      );
      if (id) coreByPlayId.set(id, record);
    }

    // secondsLeft decreases as the game progresses, so descending order plots
    // the game from kickoff to final whistle even if ESPN changes feed ordering.
    const orderedSummary = [...summaryProbabilities].sort((a: any, b: any) => {
      const aSeconds = optionalNumber(a?.secondsLeft);
      const bSeconds = optionalNumber(b?.secondsLeft);
      if (aSeconds === undefined || bSeconds === undefined) return 0;
      return bSeconds - aSeconds;
    });

    if (orderedSummary.length > 0) {
      base.probabilities = orderedSummary
        .map((summaryPoint: any) => {
          const pointId = String(summaryPoint?.playId ?? summaryPoint?.id ?? "");
          const corePoint = pointId ? (coreByPlayId.get(pointId) ?? {}) : {};
          const matchingPlay = pointId
            ? summaryPlays.find((play: any) => String(play?.id ?? play?.playId ?? "") === pointId)
            : undefined;

          return {
            homeWinProbability: asProbability(summaryPoint?.homeWinPercentage),
            homeCoverProbability: asProbability(
              corePoint?.spreadCoverProbHome ?? corePoint?.homeSpreadCoverProbability,
            ),
            overProbability: asProbability(corePoint?.totalOverProb ?? corePoint?.overProbability),
            secondsLeft: optionalNumber(summaryPoint?.secondsLeft),
            playId: pointId || undefined,
            quarter:
              Number(
                summaryPoint?.period ??
                  summaryPoint?.quarter ??
                  matchingPlay?.period?.number ??
                  matchingPlay?.period,
              ) || undefined,
            clock:
              String(
                summaryPoint?.clock?.displayValue ??
                  summaryPoint?.clock ??
                  matchingPlay?.clock?.displayValue ??
                  matchingPlay?.clock ??
                  "",
              ) || undefined,
            down:
              Number(summaryPoint?.down ?? matchingPlay?.start?.down ?? matchingPlay?.down) ||
              undefined,
            distance:
              Number(
                summaryPoint?.distance ?? matchingPlay?.start?.distance ?? matchingPlay?.distance,
              ) || undefined,
            yardLine:
              String(
                summaryPoint?.yardLine ??
                  matchingPlay?.start?.yardLine ??
                  matchingPlay?.end?.yardLine ??
                  "",
              ) || undefined,
            awayScore: optionalNumber(
              summaryPoint?.awayScore ??
                summaryPoint?.scoreAway ??
                matchingPlay?.awayScore ??
                matchingPlay?.end?.awayScore,
            ),
            homeScore: optionalNumber(
              summaryPoint?.homeScore ??
                summaryPoint?.scoreHome ??
                matchingPlay?.homeScore ??
                matchingPlay?.end?.homeScore,
            ),
            playText:
              String(
                summaryPoint?.text ??
                  summaryPoint?.playText ??
                  matchingPlay?.text ??
                  matchingPlay?.shortText ??
                  "",
              ) || undefined,
            probabilitySource:
              corePoint?.spreadCoverProbHome !== undefined ||
              corePoint?.homeSpreadCoverProbability !== undefined ||
              corePoint?.totalOverProb !== undefined ||
              corePoint?.overProbability !== undefined
                ? ("espn" as const)
                : undefined,
          };
        })
        .filter(
          (point: any) =>
            point.homeWinProbability !== undefined ||
            point.homeCoverProbability !== undefined ||
            point.overProbability !== undefined,
        );
    } else if (coreProbabilityItems.length > 0) {
      // Fallback only when ESPN's summary endpoint has no win-probability
      // history. Sort Core records by their sequence number, but do not invent
      // missing probabilities or combine unrelated records by array position.
      base.probabilities = [...coreProbabilityItems]
        .sort((a: any, b: any) => Number(a?.sequenceNumber ?? 0) - Number(b?.sequenceNumber ?? 0))
        .map((point: any) => ({
          homeWinProbability: asProbability(point?.homeWinPercentage),
          homeCoverProbability: asProbability(
            point?.spreadCoverProbHome ?? point?.homeSpreadCoverProbability,
          ),
          overProbability: asProbability(point?.totalOverProb ?? point?.overProbability),
          playId:
            String(
              point?.playId ?? point?.id ?? refId(point?.play?.$ref) ?? refId(point?.$ref) ?? "",
            ) || undefined,
          quarter: Number(point?.period ?? point?.quarter) || undefined,
          clock: String(point?.clock?.displayValue ?? point?.clock ?? "") || undefined,
          down: Number(point?.down) || undefined,
          distance: Number(point?.distance) || undefined,
          yardLine: String(point?.yardLine ?? point?.start?.yardLine ?? "") || undefined,
          awayScore: optionalNumber(point?.awayScore ?? point?.scoreAway),
          homeScore: optionalNumber(point?.homeScore ?? point?.scoreHome),
          playText: String(point?.text ?? point?.playText ?? "") || undefined,
          probabilitySource: "espn" as const,
        }))
        .filter(
          (point: any) =>
            point.homeWinProbability !== undefined ||
            point.homeCoverProbability !== undefined ||
            point.overProbability !== undefined,
        );
    }

    // The summary header omits quarter linescores and venue; merge them from
    // the week's scoreboard event.
    const sb = await fetchJson(weekScoreboardUrl(league, week)).catch(() => null);
    if (college && sb) prepareCollege(sb);
    const sbEvent = sb?.events?.find((e: any) => String(e?.id) === String(eventId));
    const sbGame = sbEvent ? mapEvent(sbEvent, week) : null;
    if (base.venue === "TBD" && d?.gameInfo?.venue?.fullName) {
      base.venue = d.gameInfo.venue.fullName;
    }
    // Fill in the stadium's city/state from the summary when the header lacks it.
    if (!base.location || base.location === "TBD") {
      const infoLocation = formatLocation(d?.gameInfo?.venue);
      if (infoLocation !== "TBD") base.location = infoLocation;
    }
    if (sbGame) {
      base.quarters = sbGame.quarters;
      base.venue = sbGame.venue !== "TBD" ? sbGame.venue : base.venue;
      if (sbGame.location && sbGame.location !== "TBD") base.location = sbGame.location;
      if (sbGame.spread !== "—") base.spread = sbGame.spread;
      if (sbGame.total > 0) base.total = sbGame.total;
      base.possession = sbGame.possession;
      base.isRedZone = sbGame.isRedZone;
      base.downDistance = sbGame.downDistance;
      base.ballSpot = sbGame.ballSpot;
      base.timeouts = sbGame.timeouts ?? base.timeouts;
      base.scoringAlert = sbGame.scoringAlert ?? base.scoringAlert;
      base.kicking = sbGame.kicking;
      base.playState = sbGame.playState;
      base.possessionText = sbGame.possessionText;
      base.distance = sbGame.distance;
      base.clock = sbGame.clock;
      base.status = sbGame.status;
      if (sbGame.awayRecord) base.awayRecord = sbGame.awayRecord;
      if (sbGame.homeRecord) base.homeRecord = sbGame.homeRecord;
    }

    if (base.status !== "scheduled" && (base.spread === "—" || !base.total)) {
      const historicalOdds = await fetchHistoricalOdds(eventId, league);
      if (base.spread === "—" && historicalOdds.spread) base.spread = historicalOdds.spread;
      if (!base.total && typeof historicalOdds.total === "number")
        base.total = historicalOdds.total;
    }

    // Repair missing/stale score snapshots before estimating market probabilities.
    // ESPN's win-probability points sometimes carry a default 0-0 score even late
    // in a game. Rebuild those snapshots from the summary's official scoring plays,
    // using period + game clock, so a bad 0-0 point cannot poison the Total curve.
    if (base.probabilities?.length && Array.isArray(d?.scoringPlays) && d.scoringPlays.length) {
      const parseClockSeconds = (value: unknown): number | undefined => {
        const text = String(value ?? "").trim();
        const match = /^(\d{1,2}):(\d{2})$/.exec(text);
        if (!match) return undefined;
        return Number(match[1]) * 60 + Number(match[2]);
      };
      const elapsedSeconds = (periodValue: unknown, clockValue: unknown): number | undefined => {
        const period = Number(periodValue);
        const clockSeconds = parseClockSeconds(clockValue);
        if (!Number.isFinite(period) || period < 1 || clockSeconds === undefined) return undefined;
        return (Math.max(1, period) - 1) * 900 + (900 - clockSeconds);
      };
      const scoringSnapshots = d.scoringPlays
        .map((play: any) => {
          const period = play?.period?.number ?? play?.period ?? play?.periodNumber;
          const clock = play?.clock?.displayValue ?? play?.clock ?? play?.time;
          const elapsed = elapsedSeconds(period, clock);
          const awayScore = optionalNumber(play?.awayScore ?? play?.scoreAway);
          const homeScore = optionalNumber(play?.homeScore ?? play?.scoreHome);
          return { elapsed, awayScore, homeScore };
        })
        .filter(
          (item: any) =>
            item.elapsed !== undefined &&
            item.awayScore !== undefined &&
            item.homeScore !== undefined,
        )
        .sort((a: any, b: any) => a.elapsed - b.elapsed);

      if (scoringSnapshots.length) {
        base.probabilities = base.probabilities.map((point) => {
          const pointElapsed =
            typeof point.secondsLeft === "number"
              ? Math.max(0, 3600 - point.secondsLeft)
              : elapsedSeconds(point.quarter, point.clock);
          const hasCredibleScore =
            typeof point.awayScore === "number" &&
            typeof point.homeScore === "number" &&
            (point.awayScore > 0 ||
              point.homeScore > 0 ||
              (pointElapsed !== undefined && pointElapsed < 60));
          if (hasCredibleScore || pointElapsed === undefined) return point;
          let snapshot: (typeof scoringSnapshots)[number] | undefined;
          for (const candidate of scoringSnapshots) {
            if (candidate.elapsed <= pointElapsed) snapshot = candidate;
            else break;
          }
          if (!snapshot) return point;
          return { ...point, awayScore: snapshot.awayScore, homeScore: snapshot.homeScore };
        });
      }
    }

    // Spread and total probabilities. Never let default/stale 0-0 score snapshots
    // feed the total estimate; the recovered score history above is used where ESPN
    // omits valid scores. Estimated curves remain explicitly marked as estimates.
    if (base.probabilities?.length) {
      base.probabilities = withMarketProbabilities(base.probabilities, base);
    }

    // Direct fallback from live summary drive if scoreboard hasn't synced
    const currentDrive = d?.drives?.current;
    if (base.status === "live" && !base.possession && currentDrive) {
      const possTeamId = teamOf(currentDrive?.team)?.id;
      if (possTeamId === base.awayTeamId) base.possession = "away";
      else if (possTeamId === base.homeTeamId) base.possession = "home";

      const plays = currentDrive.plays ?? [];
      const lastPlay = plays[plays.length - 1];
      const endState = lastPlay?.end ?? lastPlay?.start;
      if (endState) {
        if (!base.possessionText && endState.possessionText)
          base.possessionText = endState.possessionText;
        if (!base.downDistance && endState.shortDownDistanceText)
          base.downDistance = endState.shortDownDistanceText;
        if (typeof base.distance !== "number" && typeof endState.distance === "number")
          base.distance = endState.distance;
      }
    }

    base.info = parseGameInfo(d);

    // Pregame matchup predictor (shown on the Markets tab for upcoming games).
    if (base.status === "scheduled") {
      const fromSummary = parsePredictor(d?.predictor);
      const corePredictor = fromSummary
        ? null
        : await fetchJson(`${CORE_ODDS}/${eventId}/competitions/${eventId}/predictor`).catch(
            () => null,
          );
      const found = fromSummary ?? parsePredictor(corePredictor);
      if (found) base.predictor = found;
      base.seasonLeaders = parseSeasonLeaders(d?.leaders, base.awayTeamId, base.homeTeamId);
    }

    // Timeouts remaining: fall back to ESPN's core "situation" feed if the summary lacks them.
    if (base.status === "live" && !base.timeouts) {
      const coreSituation = await fetchJson(
        `${CORE_ODDS}/${eventId}/competitions/${eventId}/situation`,
      ).catch(() => null);
      const found = parseTimeouts(coreSituation) ?? parseTimeouts(d?.situation);
      if (found) base.timeouts = found;
    }

    const awayStats = d?.boxscore?.teams?.find(
      (t: any) => teamOf(t?.team)?.id === base.awayTeamId,
    );
    const homeStats = d?.boxscore?.teams?.find(
      (t: any) => teamOf(t?.team)?.id === base.homeTeamId,
    );
    if (awayStats) base.stats.away = mapTeamStats(awayStats.statistics ?? []);
    if (homeStats) base.stats.home = mapTeamStats(homeStats.statistics ?? []);

    // Per-player totals (TDs, FGs, XPs, sacks, defensive stats) for each team.
    for (const block of d?.boxscore?.players ?? []) {
      const id = teamOf(block?.team)?.id;
      const target =
        id === base.awayTeamId ? base.stats.away : id === base.homeTeamId ? base.stats.home : null;
      if (!target) continue;
      const teamStatBlock = id === base.awayTeamId ? awayStats : homeStats;
      const defTdFromTeamStat = statNum(teamStatBlock?.statistics ?? [], "defensiveTouchdowns");
      addPlayerTotals(target, block, { defTdFromTeamStat });
    }

    // ESPN's summary feed provides completed drives in `previous` and the
    // possession currently in progress in `current`. Keep the game page
    // driven by those real ESPN values instead of placeholder/sample drives.
    const rawDrives = d?.drives?.previous ?? [];
    const driveRows = [...rawDrives];
    if (d?.drives?.current) {
      const current = d.drives.current;
      const lastPrevious = rawDrives[rawDrives.length - 1];
      const currentId = current?.id ?? current?.sequenceNumber ?? current?.start?.id;
      const previousId =
        lastPrevious?.id ?? lastPrevious?.sequenceNumber ?? lastPrevious?.start?.id;
      if (!currentId || currentId !== previousId) driveRows.push(current);
    }

    const mapEspnDrive = (dr: any, index: number): Drive => {
      const teamId = teamOf(dr?.team)?.id ?? base.awayTeamId;
      const clock = (s: any) => {
        const [m, sec] = String(s?.clock?.displayValue ?? "0:00")
          .split(":")
          .map(Number);
        return (m || 0) * 60 + (sec || 0);
      };
      const topSec = Math.max(0, clock(dr?.start) - clock(dr?.end));
      const top = `${Math.floor(topSec / 60)}:${String(topSec % 60).padStart(2, "0")}`;
      const plays = Array.isArray(dr?.plays) ? dr.plays.length : Number(dr?.offensivePlays ?? 0);
      return {
        index,
        teamId,
        quarter: Number(dr?.period?.number ?? dr?.start?.period?.number ?? 1),
        plays,
        yards: Number(dr?.yards ?? 0),
        timeOfPossession: top,
        startAt: dr?.start?.text ?? "—",
        result: refineTurnoverTd(
          mapDriveResult(
            dr?.displayResult ??
              dr?.result?.displayValue ??
              dr?.result?.text ??
              dr?.result ??
              dr?.end?.result?.displayValue ??
              dr?.end?.result?.text,
          ),
          dr,
          teamOf(dr?.team)?.abbr,
        ),
      };
    };

    base.drives = driveRows.map(mapEspnDrive);

    // Live play-by-play (newest first), straight from the drives in ESPN's summary feed.
    const pbp: NonNullable<Game["playByPlay"]> = [];
    driveRows.forEach((dr: any) => {
      const driveTeamId = teamOf(dr?.team)?.id;
      const drivePlays: any[] = Array.isArray(dr?.plays) ? dr.plays : [];
      drivePlays.forEach((play: any, i: number) => {
        const rawText = String(play?.text ?? play?.shortText ?? "").trim();
        // Drop end-of-quarter marker plays entirely.
        if (
          /\bend\s+(of\s+)?(the\s+)?(\d(st|nd|rd|th)\s+)?(quarter|q\d)\b|\bend\s+quarter\b/i.test(
            rawText,
          )
        )
          return;
        // Drop official timeouts entirely.
        if (/\bofficial\s+time[\s-]?outs?\b/i.test(rawText)) return;
        // Remove the "(Shotgun)" formation tag but keep the rest of the play.
        const cleanedText = rawText
          // Formation tags like "(No Huddle)", "(Shotgun)" and "(No Huddle, Shotgun)" are not shown.
          .replace(
            /\(\s*(?:no[- ]huddle|shotgun)(?:\s*,\s*(?:no[- ]huddle|shotgun))*\s*\)\s*/gi,
            "",
          )
          // Drop where the play ended ("to BUF 43", "ran ob at BUF 42", "sacked at BUF 12");
          // the next play's header already shows the new spot.
          .replace(/\s+to\s+(?:[A-Z]{2,4}\s+\d{1,2}|the\s+50)\b/g, "")
          .replace(/\bsacked\s+at\s+[A-Z]{2,4}\s+\d{1,2}\b/gi, "sacked")
          // Drop "ran ob" / "pushed ob" (with or without a spot after it).
          .replace(/\s+(?:ran|pushed)\s+ob\b(?:\s+at\s+[A-Z]{2,4}\s+\d{1,2}\b)?/gi, "")
          .replace(/\s{2,}/g, " ")
          .replace(/\s+([.,;])/g, "$1")
          .trim();
        if (!cleanedText) return;

        const incomplete = formatIncompletePass(cleanedText);
        const defended = stripPassDefender(incomplete.text);
        const text = formatExtraPoint(
          formatMadeFieldGoal(formatPassingPlay(formatRushingPlay(defended.text))),
        );

        const header = String(
          play?.start?.downDistanceText ?? play?.start?.shortDownDistanceText ?? "",
        ).trim();
        pbp.push({
          id: String(play?.id ?? `${dr?.id ?? "d"}-${i}`),
          quarter: Number(play?.period?.number) || undefined,
          clock: play?.clock?.displayValue ? String(play.clock.displayValue) : undefined,
          teamId: teamOf(play?.team)?.id ?? driveTeamId,
          header: header || undefined,
          text,
          defender: incomplete.defender ?? defended.defender,
          scoring: Boolean(play?.scoringPlay),
        });
      });
    });
    base.playByPlay = pbp.reverse().slice(0, 60);

    const awayAbbr = teamById(base.awayTeamId)?.abbr;
    const homeAbbr = teamById(base.homeTeamId)?.abbr;
    const posMap = new Map<string, string>();
    if (awayAbbr && homeAbbr) {
      try {
        const [awayRoster, homeRoster] = await Promise.all([
          fetchTeamRoster(awayAbbr),
          fetchTeamRoster(homeAbbr),
        ]);
        for (const p of [...awayRoster, ...homeRoster]) {
          if (p.position) {
            posMap.set(p.id, p.position);
            posMap.set(p.name.toLowerCase(), p.position);
          }
        }
      } catch {
        // Fallback gracefully to group abbreviations if roster endpoint fails
      }
    }

    base.boxScore = mapBoxScore(
      d?.boxscore?.players ?? [],
      base.awayTeamId,
      base.homeTeamId,
      posMap,
    );

    // Collect every made field-goal distance from the full drive feed for kicker range stats.
    // This intentionally uses driveRows rather than the shortened play-by-play list shown in the UI.
    for (const kicker of base.boxScore.filter((line) => line.position === "K")) {
      const distances: number[] = [];
      for (const drive of driveRows) {
        const driveTeamId = teamOf(drive?.team)?.id;
        for (const play of Array.isArray(drive?.plays) ? drive.plays : []) {
          const text = String(play?.text ?? play?.shortText ?? "").trim();
          if (!/field goal/i.test(text) || /missed|no good|blocked|failed/i.test(text)) continue;
          const playTeamId = teamOf(play?.team)?.id ?? driveTeamId;
          if (playTeamId !== kicker.teamId) continue;
          if (text.toLowerCase().includes(kicker.name.toLowerCase()) === false) {
            const teamKickers = base.boxScore.filter(
              (line) => line.teamId === kicker.teamId && line.position === "K",
            );
            if (teamKickers.length !== 1) continue;
          }
          const match =
            text.match(/\b(\d{1,2})\s*(?:-?yard|yds?)\b/i) ??
            text.match(/field goal\s+(?:is\s+)?good\s+from\s+(?:the\s+)?(\d{1,2})/i);
          const distance = Number(match?.[1] ?? 0);
          if (distance > 0 && distance <= 70) distances.push(distance);
        }
      }
      kicker.fieldGoalDistances = distances;
    }

    // Yards after catch is not in ESPN's box score, so ask ESPN's per-player game stats
    // for finished games' quarterbacks, running backs, wide receivers, and tight ends. Anything missing shows as "—".
    if (base.status === "final") {
      const espnTeamIds = new Map<string, string>();
      for (const block of d?.boxscore?.players ?? []) {
        const ourId = teamOf(block?.team)?.id;
        if (ourId && block?.team?.id) espnTeamIds.set(ourId, String(block.team.id));
      }
      await Promise.all(
        base.boxScore
          .filter(
            (line) =>
              (line.position === "QB" ||
                line.position === "RB" ||
                line.position === "WR" ||
                line.position === "TE") &&
              line.playerId &&
              line.stats,
          )
          .map(async (line) => {
            const espnTeamId = espnTeamIds.get(line.teamId);
            if (!espnTeamId) return;
            try {
              const stats = await cached(
                `yac-${eventId}-${line.playerId}`,
                () =>
                  fetchJson(
                    `${CORE_ODDS}/${eventId}/competitions/${eventId}/competitors/${espnTeamId}/roster/${line.playerId}/statistics/0`,
                  ),
                HISTORICAL_ODDS_CACHE_TTL_MS,
              );
              const yac = extractYacValue(stats);
              if (yac !== undefined) line.stats!.yardsAfterCatch = String(yac);
            } catch {
              // leave YAC blank for this player
            }
          }),
      );
      // ESPN often exposes YAC for receivers but not the QB. When exactly one
      // quarterback attempted a pass for a team, use that team's receiver YAC total
      // as the QB's passing-YAC total; never assign a team total to multiple QBs.
      for (const teamId of [base.awayTeamId, base.homeTeamId]) {
        const qbs = base.boxScore.filter(
          (line) =>
            line.teamId === teamId &&
            line.position === "QB" &&
            line.stats &&
            Number(
              String(
                line.stats.passingAttempts ?? line.stats["completions/passingAttempts"] ?? "0",
              ).match(/(?:\d+\s*[-/]\s*)?(\d+)/)?.[1] ?? 0,
            ) > 0,
        );
        if (qbs.length !== 1) continue;
        const qb = qbs[0];
        if (Number(qb.stats!.yardsAfterCatch ?? 0) > 0) continue;
        const receiverYac = base.boxScore
          .filter(
            (line) =>
              line.teamId === teamId &&
              ["RB", "WR", "TE"].includes(line.position) &&
              line.stats?.yardsAfterCatch !== undefined,
          )
          .reduce((sum, line) => sum + (Number(line.stats!.yardsAfterCatch) || 0), 0);
        if (receiverYac > 0) qb.stats!.yardsAfterCatch = String(receiverYac);
      }

      // nflverse publishes real yards-after-catch numbers (PYAC for passers, YAC for receivers)
      // after games finish. When it has a player, use its number over the estimates above.
      for (const line of college ? [] : base.boxScore) {
        if (!["QB", "RB", "WR", "TE"].includes(line.position) || !line.stats) continue;
        try {
          const row = await nflverseGameYac(line.name, SEASON, base.week);
          if (row) line.stats.yardsAfterCatch = String(line.position === "QB" ? row.pyac : row.yac);
        } catch {
          // keep whatever ESPN-based value we have
        }
      }
    }
    // College teams aren't in the site's built-in team list: send them with the game.
    if (college) base.teamRefs = collegeTeamRefs(base);
    return base;
  });
  // A fresh server instance may hold the game in its cache without its college teams.
  if (game?.teamRefs) registerTeams(game.teamRefs);
  return game;
}
