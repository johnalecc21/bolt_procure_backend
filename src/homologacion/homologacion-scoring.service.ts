import { Injectable, Logger } from '@nestjs/common';
import { DocumentoHomologacion } from '@prisma/client';
import { SupabaseService } from '../supabase/supabase.service';
import { OcrService } from './ocr.service';
import { OfacService } from './ofac.service';

const BUCKET = 'homologacion-documentos';

export interface ResultadoEvaluacion {
  score: number;
  alertas: string[];
  nitDetectado: string | null;
}

interface ResultadoDocumento {
  alerta?: string;
  nitBonus?: number;
  nitDetectado?: string;
}

/**
 * Pure evaluation: downloads + OCRs every uploaded document, cross-checks
 * NIT/RUT, screens the proveedor name against OFAC/SDN, and scores the
 * result. No Prisma writes, no state-machine transition, no audit log —
 * that orchestration lives in HomologacionService.enviar(), which is the
 * only caller. Split out so this can be unit-tested by mocking Supabase/
 * OCR/OFAC instead of also having to fake a Prisma transaction.
 */
@Injectable()
export class HomologacionScoringService {
  private readonly logger = new Logger(HomologacionScoringService.name);

  constructor(
    private supabase: SupabaseService,
    private ocr: OcrService,
    private ofac: OfacService,
  ) {}

  async evaluar(documentos: DocumentoHomologacion[], proveedorNombre: string): Promise<ResultadoEvaluacion> {
    // Independent per document — nothing here needs the previous document's
    // result, so there's no reason to download/OCR them one at a time.
    const resultados = await Promise.all(documentos.map((doc) => this.evaluarDocumento(doc)));

    const alertas = resultados.flatMap((r) => (r.alerta ? [r.alerta] : []));
    const nitDetectado = resultados.find((r) => r.nitDetectado)?.nitDetectado ?? null;
    let score = 70 + resultados.reduce((sum, r) => sum + (r.nitBonus ?? 0), 0);

    const ofacResult = await this.ofac.checkName(proveedorNombre);
    if (ofacResult.matched) {
      alertas.push(
        `Posible coincidencia en la lista OFAC/SDN: "${ofacResult.matchedName}" (similitud ${Math.round((ofacResult.similarity ?? 0) * 100)}%).`,
      );
      score = Math.min(score, 20);
    } else {
      score += 10;
    }

    score = Math.max(0, Math.min(100, score));
    return { score, alertas, nitDetectado };
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
