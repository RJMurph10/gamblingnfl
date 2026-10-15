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
  if (price === undefined || price === null || price === "") return undefined;
  const fromAmericanText = (text: string): string | undefined => {
    const t = text.trim();
    if (!/^[+-]?\d+$/.test(t)) return undefined;
    return /^\d/.test(t) ? `+${t}` : t;
  };
  if (typeof price === "string") return fromAmericanText(price);
  if (typeof price === "number") {
    // Whole numbers of 100+ are already American odds; small numbers are decimal odds.
    if (Math.abs(price) >= 100) return price > 0 ? `+${Math.round(price)}` : `${Math.round(price)}`;
    return price > 1 ? decimalToAmerican(price) : undefined;
  }
  const american = price?.american ?? price?.americanOdds ?? price?.alternateDisplayValue ?? price?.displayValue;
  if (typeof american === "string" || typeof american === "number") {
    const text = fromAmericanText(String(american));
    if (text) return text;
  }
  const decimal = Number(price?.decimal ?? price?.value);
  return Number.isFinite(decimal) && decimal > 1 ? decimalToAmerican(decimal) : undefined;
}

/** Looks through a prop item for any American / decimal price field ESPN may use. */
export function findPropPrice(x: any): string | undefined {
  const candidates = [
    x?.current?.over,
    x?.current?.yes,
    x?.current?.moneyline,
    x?.current?.odds,
    x?.current?.price,
    x?.odds?.over,
    x?.odds?.yes,
    x?.odds,
    x?.moneyline,
    x?.price,
    x?.over,
    x?.yes,
  ];
  for (const candidate of candidates) {
    const price = priceToAmerican(candidate);
    if (price) return price;
  }
  // Last resort: any key that looks like American odds anywhere inside the item.
  const seen = new Set<any>();
  const walk = (node: any, depth: number): string | undefined => {
    if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return undefined;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (/american/i.test(key)) {
        const price = priceToAmerican(value);
        if (price) return price;
      }
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return walk(x, 0);
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
        const overPrice = findPropPrice(x);
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

/** One raw touchdown-scorer item, for diagnosing where ESPN puts the price. */
export function sampleTdItem(items: any[]): string | undefined {
  const item = items.find((x) => {
    const name = String(x?.type?.name ?? x?.name ?? "");
    return classifyProp(name.replace(/\s*milestones?$/i, ""))?.category === "td";
  });
  if (!item) return undefined;
  const { competition: _c, provider: _p, ...rest } = item as Record<string, unknown>;
  return JSON.stringify(rest).slice(0, 1500);
}
