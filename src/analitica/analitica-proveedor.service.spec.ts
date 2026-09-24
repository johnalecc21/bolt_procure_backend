import { AnaliticaProveedorService } from './analitica-proveedor.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProveedoresService } from '../proveedores/proveedores.service';

function invitacion(
  feedbackCompetitivo: boolean,
  adj: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    createdAt: new Date('2026-03-01T00:00:00Z'),
    estado: 'RESPONDIDA',
    requerimiento: {
      id: 'r1',
      numero: 3,
      titulo: 'Montaje',
      categoria: 'Servicios',
      moneda: 'COP',
      fechaLimite: new Date('2026-03-10T00:00:00Z'),
      company: { nombre: 'Acme', feedbackCompetitivo },
      ofertas: [
        {
          proveedorId: 'yo',
          precioTotal: 110,
          createdAt: new Date('2026-03-02T00:00:00Z'),
        },
        {
          proveedorId: 'otro',
          precioTotal: 100,
          createdAt: new Date('2026-03-02T00:00:00Z'),
        },
      ],
      auctionSession: null,
      adjudicaciones: adj ? [adj] : [],
      contratos: [
        {
          createdAt: new Date('2026-03-12T00:00:00Z'),
          proveedorId: adj?.proveedorId,
        },
      ],
      ...extra,
    },
  };
}

function build(invitaciones: unknown[]) {
  const prisma = {
    proveedorProfile: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ nombre: 'Yo SAS', vitrinaVistas: 42 }),
    },
    invitacion: { findMany: jest.fn().mockResolvedValue(invitaciones) },
    contrato: { findMany: jest.fn().mockResolvedValue([]) },
    pagoPO: { findMany: jest.fn().mockResolvedValue([]) },
    hitoSeguimiento: { findMany: jest.fn().mockResolvedValue([]) },
    evaluacionDesempeno: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const proveedores = { findIdForUser: jest.fn().mockResolvedValue('yo') };
  return new AnaliticaProveedorService(
    prisma as unknown as PrismaService,
    proveedores as unknown as ProveedoresService,
  );
}

const perdido = {
  proveedorId: 'otro',
  precioFinal: 100,
  confirmada: true,
  firmado: true,
  createdAt: new Date('2026-03-11T00:00:00Z'),
};

describe('AnaliticaProveedorService', () => {
  it('muestra posición y brecha solo si la empresa compradora lo activó', async () => {
    const con = (
      await build([invitacion(true, perdido)]).datos('u', {
        desde: '2026-01-01',
        hasta: '2026-06-30',
      })
    ).procesos[0];
    expect(con).toMatchObject({
      resultado: 'perdido',
      competenciaVisible: true,
      posicion: 2,
      participantes: 2,
    });
    expect(con.brechaPct).toBeCloseTo(0.1);

    const sin = (await build([invitacion(false, perdido)]).datos('u', {}))
      .procesos[0];
    expect(sin).toMatchObject({
      resultado: 'perdido',
      competenciaVisible: false,
      posicion: null,
      participantes: null,
      brechaPct: null,
    });
  });

  it('nunca expone el precio adjudicado de otro proveedor', async () => {
    const p = (await build([invitacion(true, perdido)]).datos('u', {}))
      .procesos[0];
    expect(p.precioAdjudicado).toBeNull();
    expect(JSON.stringify(p)).not.toContain('otro');
  });

  it('distingue ganado, seleccionado, pendiente y sin oferta', async () => {
    const ganado = { ...perdido, proveedorId: 'yo', precioFinal: 110 };
    const svc = build([
      invitacion(true, ganado),
      invitacion(true, { ...ganado, firmado: false }),
      invitacion(true, null),
      invitacion(true, null, { ofertas: [] }),
    ]);
    const r = (await svc.datos('u', {})).procesos.map((p) => [
      p.resultado,
      p.precioAdjudicado,
    ]);
    expect(r).toEqual([
      ['ganado', 110],
      ['seleccionado', 110],
      ['pendiente', null],
      ['sin_oferta', null],
    ]);
  });

  it('omite invitaciones sin requerimiento', async () => {
    const svc = build([
      { createdAt: new Date(), estado: 'NUEVA', requerimiento: null },
    ]);
    expect((await svc.datos('u', {})).procesos).toEqual([]);
  });
});
