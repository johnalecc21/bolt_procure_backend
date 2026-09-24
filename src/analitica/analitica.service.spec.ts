import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AnaliticaService } from './analitica.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EstructuraService } from '../estructura/estructura.service';

function build() {
  const prisma = {
    company: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ monedaBase: 'COP', pais: 'CO', nombre: 'Acme' }),
    },
    requerimiento: { findMany: jest.fn().mockResolvedValue([]) },
    contrato: { findMany: jest.fn().mockResolvedValue([]) },
    pagoPO: { findMany: jest.fn().mockResolvedValue([]) },
    hitoSeguimiento: { findMany: jest.fn().mockResolvedValue([]) },
    evaluacionDesempeno: { findMany: jest.fn().mockResolvedValue([]) },
    graficaGuardada: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const estructura = {
    ejecucion: jest
      .fn()
      .mockImplementation((_c: string, anio: number) =>
        Promise.resolve({ anio, centros: [] }),
      ),
  };
  const svc = new AnaliticaService(
    prisma as unknown as PrismaService,
    estructura as unknown as EstructuraService,
  );
  return { svc, prisma, estructura };
}

const proceso = (extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  numero: 7,
  titulo: 'Montaje',
  categoria: 'Servicios',
  prioridad: 'ALTA',
  estado: 'EN_CUMPLIMIENTO',
  moneda: 'COP',
  montoEstimado: 1000,
  createdAt: new Date('2026-03-01T10:00:00Z'),
  fechaLimite: new Date('2026-03-10T04:59:59Z'),
  centroCosto: {
    id: 'cc1',
    codigo: 'MTO',
    nombre: 'Mantenimiento',
    unidadNegocio: { id: 'u1', nombre: 'Planta' },
  },
  solicitante: { nombre: 'Carlos' },
  invitaciones: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
  ofertas: [{ precioTotal: 900 }, { precioTotal: 950 }],
  aprobaciones: [
    { estado: 'RECHAZADA', resueltoAt: new Date('2026-03-02T00:00:00Z') },
    { estado: 'APROBADA', resueltoAt: new Date('2026-03-03T00:00:00Z') },
  ],
  adjudicacion: {
    proveedorId: 'p1',
    precioFinal: 850,
    firmado: true,
    createdAt: new Date('2026-03-12T00:00:00Z'),
  },
  auctionSession: {
    pujas: [
      { montoInicial: 900, monto: 850 },
      { montoInicial: 950, monto: 940 },
    ],
  },
  contratos: [
    {
      createdAt: new Date('2026-03-15T00:00:00Z'),
      proveedorNombre: 'Prov Uno',
    },
  ],
  ...extra,
});

describe('AnaliticaService.cfo', () => {
  it('usa 6 meses por defecto e incluye un período anterior igual de largo', async () => {
    const { svc } = build();
    const r = await svc.cfo('c', { hasta: '2026-06-30' });
    expect(r.desde).toBe('2025-12-30');
    expect(r.hasta).toBe('2026-06-30');
    expect(r.desdeAnterior).toBe('2025-06-30');
    expect(r.moneda).toBe('COP');
  });

  it('rechaza rangos invertidos o de más de 3 años', async () => {
    const { svc } = build();
    await expect(
      svc.cfo('c', { desde: '2026-05-01', hasta: '2026-04-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.cfo('c', { desde: '2020-01-01', hasta: '2026-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pide la ejecución de presupuesto de cada año del período', async () => {
    const { svc, estructura } = build();
    const r = await svc.cfo('c', { desde: '2025-11-01', hasta: '2026-02-28' });
    expect(
      (estructura.ejecucion.mock.calls as [string, number][]).map((c) => c[1]),
    ).toEqual([2025, 2026]);
    expect(r.presupuestos).toHaveLength(2);
  });

  it('arma cada proceso con competencia, negociación, aprobación y firma', async () => {
    const { svc, prisma } = build();
    prisma.requerimiento.findMany.mockResolvedValue([proceso()]);
    const [p] = (
      await svc.cfo('c', { desde: '2026-01-01', hasta: '2026-06-30' })
    ).procesos;
    expect(p).toMatchObject({
      codigo: 'REQ-0007',
      invitados: 3,
      ofertas: 2,
      mejorOferta: 900,
      rechazos: 1,
      aprobado: '2026-03-03T00:00:00.000Z',
      negociado: true,
      negociacionInicial: 900,
      negociacionFinal: 850,
      precioFinal: 850,
      proveedorAdjudicado: 'Prov Uno',
      firmado: '2026-03-15T00:00:00.000Z',
      centroCosto: 'MTO — Mantenimiento',
      unidad: 'Planta',
    });
  });

  it('no marca firma si la adjudicación no está firmada', async () => {
    const { svc, prisma } = build();
    prisma.requerimiento.findMany.mockResolvedValue([
      proceso({
        adjudicacion: {
          proveedorId: 'p1',
          precioFinal: 850,
          firmado: false,
          createdAt: new Date(),
        },
        contratos: [],
      }),
    ]);
    const [p] = (await svc.cfo('c', {})).procesos;
    expect(p.firmado).toBeNull();
  });

  it('avisa cuando se recortan filas', async () => {
    const { svc, prisma } = build();
    prisma.requerimiento.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, () => proceso()),
    );
    const r = await svc.cfo('c', {});
    expect(r.truncado).toBe(true);
    expect(r.procesos).toHaveLength(5000);
  });
});

describe('AnaliticaService gráficas guardadas', () => {
  it('limita a 20 por usuario', async () => {
    const { svc, prisma } = build();
    prisma.graficaGuardada.count.mockResolvedValue(20);
    await expect(
      svc.crearGrafica('c', 'u', {
        titulo: 'Gasto',
        metrica: 'gasto',
        dimension: 'mes',
        tipo: 'barras',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('solo borra las propias', async () => {
    const { svc, prisma } = build();
    prisma.graficaGuardada.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.eliminarGrafica('c', 'u', 'otra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.graficaGuardada.deleteMany).toHaveBeenCalledWith({
      where: { id: 'otra', companyId: 'c', userId: 'u' },
    });
  });
});
