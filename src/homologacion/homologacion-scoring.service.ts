import { Injectable, Logger } from '@nestjs/common';
import { CategoriaDocumento, DocumentoHomologacion, NivelRiesgo, ResultadoLista } from '@prisma/client';
import { SupabaseService } from '../supabase/supabase.service';
import { OcrService } from './ocr.service';
import { ListasRestrictivasService, ResultadoVerificacion } from './listas-restrictivas.service';
import { HomologacionCuestionario, ScoreDesglose } from './homologacion-cuestionario.types';

const BUCKET = 'homologacion-documentos';

export interface ResultadoEvaluacion {
  score: number;
  scoreDesglose: ScoreDesglose;
  nivelRiesgo: NivelRiesgo;
  alertas: string[];
  nitDetectado: string | null;
  verificaciones: ResultadoVerificacion[];
}

export interface SujetoEvaluacion {
  proveedorNombre: string;
  /** Legal representative / account owner — screened alongside the company name. */
  representanteNombre?: string | null;
  ubicacion?: string | null;
}

/** Optional documents that strengthen a category when uploaded (they never block sending). */
const BONUS_OPCIONALES: Partial<Record<CategoriaDocumento, keyof ScoreDesglose>> = {
  [CategoriaDocumento.HSE]: 'compliance',
  [CategoriaDocumento.SOSTENIBILIDAD]: 'compliance',
  [CategoriaDocumento.LAFT]: 'compliance',
  [CategoriaDocumento.RIESGO_FINANCIERO]: 'financiero',
};
const BONUS_POR_OPCIONAL = 5;

interface ResultadoDocumento {
  alerta?: string;
  nitBonus?: number;
  nitDetectado?: string;
}

/** Peso de cada categoría en el score final — debe sumar 1. Ver el flujograma "5 · Evaluación integral y clasificación de riesgo". */
const PESOS: Record<keyof ScoreDesglose, number> = {
  financiero: 0.25,
  legal: 0.15,
  compliance: 0.1,
  tecnico: 0.2,
  operacional: 0.15,
  comercial: 0.15,
};

/** Umbrales de score total -> nivel de riesgo, y su cadena de aprobación / periodicidad de reevaluación. */
export const NIVEL_RIESGO_INFO: Record<
  NivelRiesgo,
  { minScore: number; aprobacionesRequeridas: string[]; reevaluacionDias: number; label: string }
> = {
  BAJO: { minScore: 80, aprobacionesRequeridas: ['Compras'], reevaluacionDias: 365, label: 'Bajo' },
  MEDIO: { minScore: 60, aprobacionesRequeridas: ['Compras', 'Finanzas'], reevaluacionDias: 182, label: 'Medio' },
  ALTO: {
    minScore: 40,
    aprobacionesRequeridas: ['Compras', 'Finanzas', 'Legal/Compliance'],
    reevaluacionDias: 91,
    label: 'Alto',
  },
  CRITICO: {
    minScore: 0,
    aprobacionesRequeridas: ['Compras', 'Finanzas', 'Legal/Compliance', 'Dirección/Comité'],
    reevaluacionDias: 30,
    label: 'Crítico',
  },
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function nivelRiesgoDeScore(score: number): NivelRiesgo {
  if (score >= NIVEL_RIESGO_INFO.BAJO.minScore) return NivelRiesgo.BAJO;
  if (score >= NIVEL_RIESGO_INFO.MEDIO.minScore) return NivelRiesgo.MEDIO;
  if (score >= NIVEL_RIESGO_INFO.ALTO.minScore) return NivelRiesgo.ALTO;
  return NivelRiesgo.CRITICO;
}

/**
 * Pure evaluation: scores the cuestionario against the 6 weighted categories
 * from the flujograma, downloads + OCRs every uploaded document, cross-checks
 * NIT/RUT, and screens the company, trade name and legal representative
 * against the restrictive lists (OFAC/SDN, ONU; Colombian ones flagged for
 * manual check). No Prisma writes,
 * no state-machine transition, no audit log — that orchestration lives in
 * HomologacionService.enviar(), which is the only caller. Split out so this
 * can be unit-tested by mocking Supabase/OCR/listas instead of also having to
 * fake a Prisma transaction.
 */
@Injectable()
export class HomologacionScoringService {
  private readonly logger = new Logger(HomologacionScoringService.name);

  constructor(
    private supabase: SupabaseService,
    private ocr: OcrService,
    private listas: ListasRestrictivasService,
  ) {}

  async evaluar(
    documentos: DocumentoHomologacion[],
    sujeto: SujetoEvaluacion,
    cuestionario: HomologacionCuestionario | null | undefined,
  ): Promise<ResultadoEvaluacion> {
    const c = cuestionario ?? {};
    const alertas: string[] = [];

    // Independent per document — nothing here needs the previous document's
    // result, so there's no reason to download/OCR them one at a time.
    const resultadosDocs = await Promise.all(documentos.map((doc) => this.evaluarDocumento(doc)));
    alertas.push(...resultadosDocs.flatMap((r) => (r.alerta ? [r.alerta] : [])));
    const nitDetectado = resultadosDocs.find((r) => r.nitDetectado)?.nitDetectado ?? null;
    const nitBonus = resultadosDocs.reduce((sum, r) => sum + (r.nitBonus ?? 0), 0);

    // The questionnaire's declared names take precedence (they're what the
    // legal documents say); the profile/account names are the fallback.
    const verificaciones = await this.listas.verificar(
      [
        c.razonSocial ?? sujeto.proveedorNombre,
        c.nombreComercial ?? '',
        c.representanteLegal ?? sujeto.representanteNombre ?? '',
      ],
      c.paisConstitucion ?? sujeto.ubicacion ?? null,
    );
    const listaHit = verificaciones.some((v) => v.resultado === ResultadoLista.COINCIDENCIA);
    // A hit, or a list that couldn't be consulted (never assumed clean),
    // sends the case to manual review (zona gris).
    for (const v of verificaciones) {
      if ((v.resultado === ResultadoLista.COINCIDENCIA || v.resultado === ResultadoLista.NO_DISPONIBLE) && v.detalle) {
        alertas.push(v.detalle);
      }
    }
    if (c.listaRestrictiva) {
      alertas.push('El proveedor declaró que él o sus socios aparecen en listas restrictivas (OFAC/ONU/Clinton List).');
    }

    const scoreDesglose: ScoreDesglose = {
      financiero: this.scoreFinanciero(c),
      legal: this.scoreLegal(c, nitBonus, listaHit || !!c.listaRestrictiva),
      compliance: this.scoreCompliance(c, listaHit),
      tecnico: this.scoreTecnico(c),
      operacional: this.scoreOperacional(c),
      comercial: this.scoreComercial(c),
    };

    for (const d of documentos) {
      const categoria = BONUS_OPCIONALES[d.categoria];
      if (!d.obligatorio && d.storagePath && categoria && !(listaHit && categoria === 'compliance')) {
        scoreDesglose[categoria] = clamp(scoreDesglose[categoria] + BONUS_POR_OPCIONAL);
      }
    }

    const score = clamp(
      Object.entries(scoreDesglose).reduce(
        (sum, [key, value]) => sum + value * PESOS[key as keyof ScoreDesglose],
        0,
      ),
    );

    return { score, scoreDesglose, nivelRiesgo: nivelRiesgoDeScore(score), alertas, nitDetectado, verificaciones };
  }

  private scoreFinanciero(c: HomologacionCuestionario): number {
    let s = 100;
    if (!c.tieneEstadosFinancierosAuditados) s -= 30;
    if (c.ingresosAnioMenos1 === undefined) s -= 20;
    if (c.patrimonio === undefined) s -= 10;
    if (c.endeudamiento !== undefined) {
      if (c.endeudamiento > 0.7) s -= 30;
      else if (c.endeudamiento > 0.5) s -= 15;
    } else {
      s -= 10;
    }
    return clamp(s);
  }

  private scoreLegal(c: HomologacionCuestionario, nitBonus: number, listaRestrictivaHit: boolean): number {
    let s = 100;
    if (listaRestrictivaHit) return 0; // hard fail — no legal score survives a restricted-list hit
    if (c.esPep) s -= 25;
    if (c.sancionado) s -= 25;
    if (c.litigios) s -= 15;
    if (c.tienePoderes === false) s -= 20;
    if (!c.vigenciaMatricula) s -= 10;
    s += nitBonus; // OCR confirmed the NIT/RUT on the uploaded document
    return clamp(s);
  }

  private scoreCompliance(c: HomologacionCuestionario, listaHit: boolean): number {
    if (listaHit) return 0; // hard fail — a restrictive-list match blocks compliance regardless of policies
    let s = 100;
    if (!c.politicaAnticorrupcion) s -= 30;
    if (!c.politicaProteccionDatos) s -= 25;
    if (c.incidentesGraves) s -= 20;
    if (!c.politicaSst) s -= 15;
    if (!c.polizasVigentes) s -= 10;
    return clamp(s);
  }

  private scoreTecnico(c: HomologacionCuestionario): number {
    let s = 100;
    if (!c.certificacionesCalidad) s -= 30;
    if (c.aniosExperienciaBienServicio === undefined || c.aniosExperienciaBienServicio < 2) s -= 30;
    else if (c.aniosExperienciaBienServicio < 5) s -= 15;
    if (!c.proyectosSimilares?.trim()) s -= 20;
    if (!c.capacidadInstalada?.trim()) s -= 20;
    return clamp(s);
  }

  private scoreOperacional(c: HomologacionCuestionario): number {
    let s = 100;
    if (c.numeroEmpleados === undefined) s -= 25;
    if (!c.coberturaGeografica?.trim()) s -= 25;
    if (c.subcontrata && !c.subcontrataDetalle?.trim()) s -= 15;
    if (c.aniosExperienciaMercado === undefined || c.aniosExperienciaMercado < 1) s -= 30;
    return clamp(s);
  }

  private scoreComercial(c: HomologacionCuestionario): number {
    const referenciasCompletas = (c.referencias ?? []).filter(
      (r) => r.empresa?.trim() && r.contacto?.trim() && r.telefono?.trim(),
    ).length;
    let s = referenciasCompletas >= 3 ? 100 : referenciasCompletas === 2 ? 70 : referenciasCompletas === 1 ? 40 : 0;
    if (!c.tipoProveedor || !c.bienServicioOfrecido?.trim()) s -= 10;
    return clamp(s);
  }

  private async evaluarDocumento(doc: DocumentoHomologacion): Promise<ResultadoDocumento> {
    if (!doc.storagePath) return {};
    const filename = doc.storagePath.split('/').pop() ?? doc.storagePath;
    const { data, error } = await this.supabase.admin.storage.from(BUCKET).download(doc.storagePath);
    if (error || !data) {
      this.logger.warn(`No se pudo descargar ${doc.storagePath}: ${error?.message}`);
      return { alerta: `No se pudo leer el documento "${doc.nombre}".` };
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const text = await this.ocr.extractText(buffer, filename);
    if (!text) {
      return { alerta: `No se pudo extraer texto del documento "${doc.nombre}" (OCR).` };
    }

    if (doc.nombre.toLowerCase().includes('nit') || doc.nombre.toLowerCase().includes('rut')) {
      const digitsOnly = text.replace(/[^0-9]/g, '');
      const match = digitsOnly.match(/\d{9,10}/);
      if (!match) {
        return { alerta: `No se detectó un número de NIT/RUT válido en "${doc.nombre}".` };
      }
      return { nitBonus: 10, nitDetectado: match[0] };
    }

    return {};
  }
}
