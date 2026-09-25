import { DocumentoHomologacion, ResultadoLista } from '@prisma/client';
import { HomologacionScoringService } from './homologacion-scoring.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { OcrService } from './ocr.service';
import type {
  ListasRestrictivasService,
  ResultadoVerificacion,
} from './listas-restrictivas.service';
import type { HomologacionCuestionario } from './homologacion-cuestionario.types';

function doc(partial: Partial<DocumentoHomologacion>): DocumentoHomologacion {
  return {
    id: 'd',
    homologacionId: 'h',
    nombre: 'Doc',
    categoria: 'LEGAL',
    obligatorio: true,
    estado: 'SUBIDO',
    vigencia: null,
    avisoVencimiento: null,
    storagePath: null,
    ...partial,
  };
}

function servicio(verificaciones: ResultadoVerificacion[]) {
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
  const listas = { verificar: jest.fn().mockResolvedValue(verificaciones) };
  const svc = new HomologacionScoringService(
    supabase as unknown as SupabaseService,
    ocr as unknown as OcrService,
    listas as unknown as ListasRestrictivasService,
  );
  return { svc, listas };
}

const limpio: ResultadoVerificacion[] = [
  { lista: 'OFAC', resultado: ResultadoLista.SIN_COINCIDENCIA, detalle: null },
];
const cuestionario: HomologacionCuestionario = {
  razonSocial: 'Acme S.A.S.',
  nombreComercial: 'Acme',
  representanteLegal: 'Ana Gómez',
  paisConstitucion: 'Colombia',
  politicaAnticorrupcion: true,
  politicaProteccionDatos: true,
  politicaSst: true,
  polizasVigentes: true,
};

describe('HomologacionScoringService', () => {
  it('screens the declared company, trade name and representative, in the declared country', async () => {
    const { svc, listas } = servicio(limpio);
    await svc.evaluar(
      [],
      {
        proveedorNombre: 'Perfil',
        representanteNombre: 'Usuario',
        ubicacion: 'Perú',
      },
      cuestionario,
    );
    expect(listas.verificar).toHaveBeenCalledWith(
      ['Acme S.A.S.', 'Acme', 'Ana Gómez'],
      'Colombia',
    );
  });

  it('falls back to the profile and account names without a questionnaire', async () => {
    const { svc, listas } = servicio(limpio);
    await svc.evaluar(
      [],
      {
        proveedorNombre: 'Perfil',
        representanteNombre: 'Usuario',
        ubicacion: 'Perú',
      },
      null,
    );
    expect(listas.verificar).toHaveBeenCalledWith(
      ['Perfil', '', 'Usuario'],
      'Perú',
    );
  });

  it('zeroes legal and compliance on a list hit and records it as an alerta', async () => {
    const { svc } = servicio([
      {
        lista: 'ONU',
        resultado: ResultadoLista.COINCIDENCIA,
        detalle: 'Posible coincidencia ONU',
      },
    ]);
    const res = await svc.evaluar(
      [],
      { proveedorNombre: 'Acme' },
      cuestionario,
    );
    expect(res.scoreDesglose.legal).toBe(0);
    expect(res.scoreDesglose.compliance).toBe(0);
    expect(res.alertas).toContain('Posible coincidencia ONU');
    expect(res.verificaciones).toHaveLength(1);
  });

  it('sends an unavailable list to manual review without zeroing the score', async () => {
    const { svc } = servicio([
      {
        lista: 'OFAC',
        resultado: ResultadoLista.NO_DISPONIBLE,
        detalle: 'No se pudo consultar la lista OFAC/SDN.',
      },
    ]);
    const res = await svc.evaluar(
      [],
      { proveedorNombre: 'Acme' },
      cuestionario,
    );
    expect(res.alertas).toEqual(['No se pudo consultar la lista OFAC/SDN.']);
    expect(res.scoreDesglose.compliance).toBe(100);
  });

  it('rewards uploaded optional documents in their category', async () => {
    const sinPolizas = { ...cuestionario, polizasVigentes: false }; // compliance 90, room for the bonus
    const { svc } = servicio(limpio);
    const base = await svc.evaluar([], { proveedorNombre: 'Acme' }, sinPolizas);
    const conHse = await svc.evaluar(
      [
        doc({
          nombre: 'HSE',
          categoria: 'HSE',
          obligatorio: false,
          storagePath: 'p/hse.pdf',
        }),
      ],
      { proveedorNombre: 'Acme' },
      sinPolizas,
    );
    expect(conHse.scoreDesglose.compliance).toBe(
      base.scoreDesglose.compliance + 5,
    );
  });
});
