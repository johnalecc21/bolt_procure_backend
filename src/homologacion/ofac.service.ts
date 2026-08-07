import { Injectable, Logger } from '@nestjs/common';

const SDN_CSV_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h — the SDN list only changes a few times a week.
const MATCH_THRESHOLD = 0.85;

export interface OfacMatch {
  matched: boolean;
  matchedName?: string;
  similarity?: number;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalize(name: string): string {
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
function similarity(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

@Injectable()
export class OfacService {
  private readonly logger = new Logger(OfacService.name);
  private cachedNames: string[] | null = null;
  private cachedAt = 0;

  private async loadList(): Promise<string[]> {
    if (this.cachedNames && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedNames;
    }
    try {
      const res = await fetch(SDN_CSV_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csv = await res.text();
      const names = csv
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseCsvLine(line)[1])
        .filter((name): name is string => !!name && name !== '-0-')
        .map(normalize);
      this.cachedNames = names;
      this.cachedAt = Date.now();
      this.logger.log(`Lista OFAC/SDN cargada: ${names.length} entidades.`);
      return names;
    } catch (err) {
      this.logger.warn(`No se pudo descargar la lista OFAC/SDN: ${(err as Error).message}`);
      return this.cachedNames ?? [];
    }
  }

  /** Screens a name against the real US Treasury OFAC SDN list (Specially Designated Nationals). */
  async checkName(name: string): Promise<OfacMatch> {
    const target = normalize(name);
    if (!target) return { matched: false };
    const list = await this.loadList();

    let best: { name: string; score: number } | null = null;
    for (const sdnName of list) {
      if (sdnName === target || sdnName.includes(target) || target.includes(sdnName)) {
        return { matched: true, matchedName: sdnName, similarity: 1 };
      }
      const score = similarity(target, sdnName);
      if (!best || score > best.score) best = { name: sdnName, score };
    }
    if (best && best.score >= MATCH_THRESHOLD) {
      return { matched: true, matchedName: best.name, similarity: best.score };
    }
    return { matched: false };
  }
}
