import { Injectable, Logger } from '@nestjs/common';
import { bestMatch, NameMatch, normalizeName } from './name-matching';
import { reportarFallo } from '../common/logging/reportar';

const ONU_XML_URL =
  'https://scsanctions.un.org/resources/xml/en/consolidated.xml';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}

/**
 * Extracts every listed name from the UN Security Council consolidated list:
 * individuals (FIRST..FOURTH_NAME joined), entities (FIRST_NAME holds the
 * full name) and all their aliases.
 */
export function parseOnuXml(xml: string): string[] {
  const names: string[] = [];
  const blocks = xml.match(/<(INDIVIDUAL|ENTITY)>[\s\S]*?<\/\1>/g) ?? [];
  for (const block of blocks) {
    const full = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
      .map((t) => tag(block, t))
      .filter(Boolean)
      .join(' ');
    if (full) names.push(full);
    for (const alias of block.match(/<ALIAS_NAME>([^<]*)<\/ALIAS_NAME>/g) ??
      []) {
      const value = alias.replace(/<\/?ALIAS_NAME>/g, '').trim();
      if (value) names.push(value);
    }
  }
  return names.map(normalizeName).filter((n) => n.length > 2);
}

@Injectable()
export class OnuService {
  private readonly logger = new Logger(OnuService.name);
  private cachedNames: string[] | null = null;
  private cachedAt = 0;

  private async loadList(): Promise<string[] | null> {
    if (this.cachedNames && Date.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedNames;
    }
    try {
      const res = await fetch(ONU_XML_URL, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const names = parseOnuXml(await res.text());
      this.cachedNames = names;
      this.cachedAt = Date.now();
      this.logger.log(
        `Lista consolidada ONU cargada: ${names.length} nombres.`,
      );
      return names;
    } catch (err) {
      // Screening falls back to the last copy; the team must know it's stale.
      reportarFallo(this.logger, 'Descarga lista ONU', err);
      return this.cachedNames;
    }
  }

  /** Screens a name against the UN Security Council consolidated sanctions list. null = list unavailable. */
  async checkName(name: string): Promise<NameMatch | null> {
    const list = await this.loadList();
    if (!list) return null;
    return bestMatch(name, list);
  }
}
