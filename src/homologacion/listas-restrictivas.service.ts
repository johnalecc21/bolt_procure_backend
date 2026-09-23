import { Injectable } from '@nestjs/common';
import { ResultadoLista } from '@prisma/client';
import { OfacService } from './ofac.service';
import { OnuService } from './onu.service';
import type { NameMatch } from './name-matching';

export interface ResultadoVerificacion {
  lista: string;
  resultado: ResultadoLista;
  detalle: string | null;
}

/**
 * Colombian lists with no public API (captcha-protected consultation pages).
 * They're recorded as PENDIENTE_MANUAL so Compliance checks them on the
 * official site and records the outcome from the review queue.
 */
export const LISTAS_MANUALES_CO: { lista: string; url: string }[] = [
  {
    lista: 'PROCURADURIA',
    url: 'https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx',
  },
  {
    lista: 'CONTRALORIA',
    url: 'https://www.contraloria.gov.co/web/guest/persona-juridica',
  },
  {
    lista: 'POLICIA',
    url: 'https://antecedentes.policia.gov.co:7005/WebJudicial/',
  },
];

export function esColombia(ubicacion: string | null | undefined): boolean {
  if (!ubicacion) return false;
  const u = ubicacion.trim().toLowerCase();
  return u === 'co' || u.includes('colombia');
}

@Injectable()
export class ListasRestrictivasService {
  constructor(
    private ofac: OfacService,
    private onu: OnuService,
  ) {}

  /** Screens every given name (company + legal representative) against each automated list. */
  async verificar(
    nombres: string[],
    ubicacion: string | null,
  ): Promise<ResultadoVerificacion[]> {
    const candidatos = nombres.map((n) => n.trim()).filter(Boolean);
    const [ofac, onu] = await Promise.all([
      this.screen(candidatos, (n) => this.ofac.checkName(n)),
      this.screen(candidatos, (n) => this.onu.checkName(n)),
    ]);
    const resultados = [
      this.toResultado('OFAC', 'lista OFAC/SDN', ofac),
      this.toResultado(
        'ONU',
        'lista consolidada del Consejo de Seguridad ONU',
        onu,
      ),
    ];
    if (esColombia(ubicacion)) {
      resultados.push(
        ...LISTAS_MANUALES_CO.map(({ lista, url }) => ({
          lista,
          resultado: ResultadoLista.PENDIENTE_MANUAL,
          detalle: `Consultar en ${url}`,
        })),
      );
    }
    return resultados;
  }

  private async screen(
    nombres: string[],
    check: (n: string) => Promise<NameMatch | null>,
  ): Promise<{ nombre: string; match: NameMatch }[] | null> {
    const out: { nombre: string; match: NameMatch }[] = [];
    for (const nombre of nombres) {
      const match = await check(nombre);
      if (!match) return null;
      out.push({ nombre, match });
    }
    return out;
  }

  private toResultado(
    lista: string,
    etiqueta: string,
    resultados: { nombre: string; match: NameMatch }[] | null,
  ): ResultadoVerificacion {
    if (!resultados) {
      return {
        lista,
        resultado: ResultadoLista.NO_DISPONIBLE,
        detalle: `No se pudo consultar la ${etiqueta}.`,
      };
    }
    const hit = resultados.find((r) => r.match.matched);
    if (hit) {
      return {
        lista,
        resultado: ResultadoLista.COINCIDENCIA,
        detalle: `Posible coincidencia en la ${etiqueta} para "${hit.nombre}": "${hit.match.matchedName}" (similitud ${Math.round((hit.match.similarity ?? 0) * 100)}%).`,
      };
    }
    return { lista, resultado: ResultadoLista.SIN_COINCIDENCIA, detalle: null };
  }
}
