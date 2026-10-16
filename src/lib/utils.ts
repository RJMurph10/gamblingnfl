import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats live rushing play descriptions to omit the run direction.
 * Example: "J.Dobbins right tackle for 1 yard" -> "J.Dobbins 1 yard rush"
 */
export function formatPlayDescription(text: string): string {
  if (!text) return text;
  
  const rushPattern = /^([A-Za-z0-9\.\'\-]+)\s+(?:right tackle|left tackle|right guard|left guard|left end|right end|up the middle|middle|center|left|right)\s+for\s+(-?\d+\s+yards?)/i;

  const match = text.match(rushPattern);
  if (match) {
    const [, player, yards] = match;
    return `${player} ${yards} rush`;
  }

  return text;
}
