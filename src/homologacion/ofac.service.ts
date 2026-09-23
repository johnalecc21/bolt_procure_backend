import { Injectable, Logger } from '@nestjs/common';
import { bestMatch, NameMatch, normalizeName } from './name-matching';

const SDN_CSV_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h — the SDN list only changes a few times a week.

export type OfacMatch = NameMatch;

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

export function parseSdnCsv(csv: string): string[] {
  return csv
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseCsvLine(line)[1])
    .filter((name): name is string => !!name && name !== '-0-')
    .map(normalizeName);
}

@Injectable()
export class OfacService {
  private readonly logger = new Logger(OfacService.name);
  private cachedNames: string[] | null = null;
  private cachedAt = 0;

  /** null when the list could not be downloaded and nothing is cached — callers must not treat that as "clean". */
  private async loadList(): Promise<string[] | null> {
    if (this.cachedNames && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedNames;
    }
    try {
      const res = await fetch(SDN_CSV_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const names = parseSdnCsv(await res.text());
      this.cachedNames = names;
      this.cachedAt = Date.now();
      this.logger.log(`Lista OFAC/SDN cargada: ${names.length} entidades.`);
      return names;
    } catch (err) {
      this.logger.warn(`No se pudo descargar la lista OFAC/SDN: ${(err as Error).message}`);
      return this.cachedNames;
    }
  }

  /**
   * Screens a name against the real US Treasury OFAC SDN list (Specially
   * Designated Nationals). Returns null when the list is unavailable.
   */
  async checkName(name: string): Promise<OfacMatch | null> {
    const list = await this.loadList();
    if (!list) return null;
    return bestMatch(name, list);
  }
}
