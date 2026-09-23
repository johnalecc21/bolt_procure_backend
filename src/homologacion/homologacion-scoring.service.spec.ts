import { DocumentoHomologacion, ResultadoLista } from '@prisma/client';
import { HomologacionScoringService } from './homologacion-scoring.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { OcrService } from './ocr.service';
import type {
  ListasRestrictivasService,
  ResultadoVerificacion,
} from './listas-restrictivas.service';

function doc(partial: Partial<DocumentoHomologacion>): DocumentoHomologacion {
  return {
    id: 'd',
    homologacionId: 'h',
    nombre: 'Doc',
    categoria: 'LEGAL',
    obligatorio: true,
    estado: 'SUBIDO',
    vigencia: null,
    storagePath: null,
    ...partial,
  };
}

function servicio(verificaciones: ResultadoVerificacion[]) {
  const listas = { verificar: jest.fn().mockResolvedValue(verificaciones) };
  const supabase = {
    admin: {
      storage: {
        from: () => ({
          download: () =>
            Promise.resolve({ data: new Blob(['pdf']), error: null }),
        }),
      },
    },
  };
  const ocr = {
    extractText: jest.fn().mockResolvedValue('Certificado vigente'),
  };
  const svc = new HomologacionScoringService(
    supabase as unknown as SupabaseService,
    ocr as unknown as OcrService,
    listas as unknown as ListasRestrictivasService,
  );
  return { svc, listas };
}

const limpio = [
  { lista: 'OFAC', resultado: ResultadoLista.SIN_COINCIDENCIA, detalle: null },
];

describe('HomologacionScoringService', () => {
  it('screens both the company and its representative', async () => {
    const { svc, listas } = servicio(limpio);
    await svc.evaluar([], {
      proveedorNombre: 'Acme',
      representanteNombre: 'Ana',
      ubicacion: 'Colombia',
    });
    expect(listas.verificar).toHaveBeenCalledWith(['Acme', 'Ana'], 'Colombia');
  });

  it('rewards clean lists and uploaded optional documents', async () => {
    const { svc } = servicio(limpio);
    const res = await svc.evaluar(
      [
        doc({ obligatorio: false, storagePath: null }),
        doc({ nombre: 'HSE', obligatorio: false, storagePath: 'p/hse.pdf' }),
      ],
      { proveedorNombre: 'Acme' },
    );
    // 70 base + 10 clean lists + 2 for the one uploaded optional document.
    expect(res.score).toBe(82);
    expect(res.alertas).toEqual([]);
  });

  it('caps the score on a list hit and records it as an alerta', async () => {
    const { svc } = servicio([
      {
        lista: 'ONU',
        resultado: ResultadoLista.COINCIDENCIA,
        detalle: 'Posible coincidencia ONU',
      },
    ]);
    const res = await svc.evaluar([], { proveedorNombre: 'Acme' });
    expect(res.score).toBe(20);
    expect(res.alertas).toContain('Posible coincidencia ONU');
  });

  it('sends an unavailable list to manual review without the clean-list bonus', async () => {
    const { svc } = servicio([
      {
        lista: 'OFAC',
        resultado: ResultadoLista.NO_DISPONIBLE,
        detalle: 'No se pudo consultar la lista OFAC/SDN.',
      },
    ]);
    const res = await svc.evaluar([], { proveedorNombre: 'Acme' });
    expect(res.score).toBe(70);
    expect(res.alertas).toHaveLength(1);
  });
});
