import type { LivePropOffer } from "@/lib/props.types";

export interface PropPerson {
  name: string;
  position: string;
  headshot?: string;
  team: string;
}

/** Athlete id from a prop item (ESPN names it only in a $ref URL). */
export function athleteIdOf(x: any): string | undefined {
  return /\/athletes\/(\d+)/.exec(x?.athlete?.$ref ?? "")?.[1] ?? (x?.athlete?.id ? String(x.athlete.id) : undefined);
}

export function decimalToAmerican(decimal: number): string {
  if (!(decimal > 1)) return "";
  const value = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
  return value > 0 ? `+${value}` : `${value}`;
}

/** Reads a price object ({ american, decimal, value }) into American odds text. */
export function priceToAmerican(price: any): string | undefined {
  if (price === undefined || price === null) return undefined;
  const american = price?.american ?? price?.alternateDisplayValue;
  if (typeof american === "string" && /^[+-]?\d+$/.test(american.trim())) {
    const text = american.trim();
    return /^\d/.test(text) ? `+${text}` : text;
  }
  const decimal = Number(price?.decimal ?? price?.value ?? (typeof price === "number" ? price : NaN));
  return Number.isFinite(decimal) && decimal > 1 ? decimalToAmerican(decimal) : undefined;
}

/** "Total Passing Yards (incl. overtime)" -> "Passing Yards" */
export function cleanMarketName(name: string): string {
  return name
    .replace(/\s*\(incl\.? overtime\)/i, "")
    .replace(/^total\s+/i, "")
    .replace(/\bplus\b/i, "+")
    .replace(/touchdowns?/i, "TDs")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyProp(
  baseName: string,
): { category: LivePropOffer["category"]; market: string; yes?: boolean } | null {
  const n = baseName.toLowerCase();
  const market = cleanMarketName(baseName);
  if (/first.*(touchdown|td)/.test(n)) return { category: "td", market: "First TD", yes: true };
  if (/(2|two)\+?.*(touchdown|td)|multiple.*touchdown/.test(n)) return { category: "td", market: "2+ TDs", yes: true };
  if (/anytime.*(touchdown|td)|touchdown scorer|to score.*touchdown|score a touchdown/.test(n)) {
    return { category: "td", market: "Anytime TD", yes: true };
  }
  if (/passing|pass completions|completion/.test(n)) return { category: "passing", market };
  if (/rushing|carries|longest rush/.test(n)) return { category: "rushing", market };
  if (/receiving|receptions|catches|longest reception/.test(n)) return { category: "receiving", market };
  return null;
}


/** Turns ESPN propBets items into board offers (shared by the server and the browser fallback). */
export function buildPropOffers(items: any[], people: Map<string, PropPerson>): LivePropOffer[] {
  const offers: LivePropOffer[] = [];
      const seen = new Set<string>();
      for (const x of items) {
        const typeName = String(x?.type?.name ?? x?.type?.displayName ?? x?.type?.text ?? x?.displayName ?? x?.name ?? "");
        const isMilestone = /milestones?$/i.test(typeName);
        const kindInfo = classifyProp(typeName.replace(/\s*milestones?$/i, ""));
        const athleteId = /\/athletes\/(\d+)/.exec(x?.athlete?.$ref ?? "")?.[1] ?? (x?.athlete?.id ? String(x.athlete.id) : undefined);
        if (!kindInfo || !athleteId) continue;
        const person = people.get(athleteId);
        if (!person?.name) continue;

        const line = Number(x?.current?.target?.value ?? x?.current?.target?.displayValue);
        const openLine = Number(x?.open?.target?.value ?? x?.open?.target?.displayValue);
        const overPrice = priceToAmerican(x?.current?.over ?? x?.odds?.over ?? x?.odds?.decimal ?? x?.odds);
        const underPrice = priceToAmerican(x?.current?.under ?? x?.odds?.under);
        const yes = Boolean(kindInfo.yes);
        const hasLine = Number.isFinite(line) && line > 0;
        if (!yes && !hasLine) continue;
        const kind: LivePropOffer["kind"] = yes ? "yes" : underPrice && !isMilestone ? "over-under" : isMilestone ? "milestone" : "over-under";

        const key = `${athleteId}|${kindInfo.market}|${yes ? 0 : line}|${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offers.push({
          playerId: athleteId,
          playerName: person.name,
          teamAbbr: person.team,
          position: person.position,
          headshot: person.headshot,
          category: kindInfo.category,
          market: kindInfo.market,
          kind,
          line: yes ? undefined : line,
          openLine: !yes && Number.isFinite(openLine) ? openLine : undefined,
          overOdds: overPrice,
          underOdds: underPrice,
        });
      }

  return offers;
}
