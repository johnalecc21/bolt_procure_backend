/** Shared fuzzy name matching for restrictive-list screening (OFAC, ONU). */

export const MATCH_THRESHOLD = 0.85;

export interface NameMatch {
  matched: boolean;
  matchedName?: string;
  similarity?: number;
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Sørensen–Dice coefficient over character bigrams — cheap, order-insensitive fuzzy match. */
export function similarity(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/** `list` must already be normalized with normalizeName. */
export function bestMatch(name: string, list: string[]): NameMatch {
  const target = normalizeName(name);
  if (!target) return { matched: false };

  let best: { name: string; score: number } | null = null;
  for (const listed of list) {
    if (
      listed === target ||
      listed.includes(target) ||
      target.includes(listed)
    ) {
      return { matched: true, matchedName: listed, similarity: 1 };
    }
    const score = similarity(target, listed);
    if (!best || score > best.score) best = { name: listed, score };
  }
  if (best && best.score >= MATCH_THRESHOLD) {
    return { matched: true, matchedName: best.name, similarity: best.score };
  }
  return { matched: false };
}
