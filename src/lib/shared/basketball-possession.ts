/**
 * Which basketball team has the ball during a live game, from ESPN's game summary (NBA and men's
 * college basketball use the same feed). ESPN's explicit possession field wins; otherwise the
 * play-by-play is read, and the answer is only given after a clear event (a rebound, a made shot,
 * a turnover, the last free throw): ambiguous moments return nothing rather than a guess.
 */
export function possessionFromSummary(
  json: any,
  game: { away: { team: { id: string } }; home: { team: { id: string } } },
  plays: any[],
): string | undefined {
  const valid = new Set([game.away.team.id, game.home.team.id].filter(Boolean));
  const situation = json?.situation;
  const competitors: any[] = json?.header?.competitions?.[0]?.competitors ?? [];
  const direct = [
    situation?.possession?.id,
    situation?.possession?.team?.id,
    situation?.possessionTeam?.id,
    situation?.possessionTeamId,
    competitors.find((c) => c?.possession === true || c?.possession === "true")?.id,
  ].map((id) => (id == null ? "" : String(id)));
  const explicit = direct.find((id) => valid.has(id));
  if (explicit) return explicit;

  let possession: string | undefined;
  let previousMadeShotTeam: string | undefined;
  for (const play of plays) {
    const teamId = String(play?.team?.id ?? play?.teamId ?? "");
    const text = String(play?.text ?? play?.shortDescription ?? play?.type?.text ?? "").toLowerCase();
    if (!text) continue;
    const knownTeam = valid.has(teamId) ? teamId : undefined;
    const opponent = (id: string | undefined) =>
      id === game.away.team.id ? game.home.team.id : id === game.home.team.id ? game.away.team.id : undefined;

    if (/\b(rebound|rebounds)\b/.test(text) && !/rebound violation/.test(text)) {
      if (knownTeam) possession = knownTeam;
      continue;
    }

    if (/\bfree throw\b/.test(text)) {
      if (/technical/.test(text) || /miss(?:es|ed)?\s+(?:the\s+)?free throw/.test(text)) {
        possession = undefined;
        continue;
      }
      const made = /\b(?:makes?|made)\b.*free throw|free throw.*\bmade\b/.test(text);
      if (!made || !knownTeam) {
        possession = undefined;
        continue;
      }
      const ordinal = text.match(/\b(\d+)\s*(?:st|nd|rd|th)?\s+of\s+(\d+)\b/);
      if (!ordinal) possession = undefined;
      else possession = Number(ordinal[1]) < Number(ordinal[2]) ? knownTeam : opponent(knownTeam);
      continue;
    }

    if (/\bturnover\b/.test(text)) {
      possession = /\bsteal(?:s|en)?\b/.test(text) ? knownTeam : opponent(knownTeam);
      continue;
    }
    if (/\bsteals?\b/.test(text) && knownTeam) {
      possession = knownTeam;
      continue;
    }

    const shot = /\b(2|3)-pt\b|\b(two|three)-point\b|\b(?:layup|dunk|jumper|jump shot|hook shot|tip-in)\b/.test(text);
    const made = /\b(make|makes|made)\b/.test(text) && shot;
    const missed = /\b(miss|misses|missed)\b/.test(text) && shot;
    if (made && knownTeam) {
      previousMadeShotTeam = knownTeam;
      // A made shot with an and-one/shooting foul leaves the shooter at the line.
      possession = /foul|and.?one|free throw/.test(text) ? knownTeam : opponent(knownTeam);
      continue;
    }
    if (missed) {
      possession = undefined;
      continue;
    }
    if (/\bfoul\b/.test(text) && /shooting|and.?one/.test(text) && previousMadeShotTeam) {
      possession = previousMadeShotTeam;
    }
  }
  return possession && valid.has(possession) ? possession : undefined;
}
