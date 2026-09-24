import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoSubasta } from '@prisma/client';
import { SubastaService } from './subasta.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProveedoresService } from '../proveedores/proveedores.service';

function build() {
  const prisma = {
    puja: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    auctionSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ id: 's1' }),
    },
    oferta: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const svc = new SubastaService(
    prisma as unknown as PrismaService,
    {} as ProveedoresService,
  );
  return { svc, prisma };
}

const activa = (extra = {}) => ({
  id: 's1',
  requerimientoId: 'r1',
  status: EstadoSubasta.ACTIVA,
  deadline: new Date(Date.now() + 60_000),
  pujas: [{ proveedorId: 'p1', monto: 100 }],
  ...extra,
});

describe('SubastaService.pujar', () => {
  it('guarda la puja con una sola actualización condicionada', async () => {
    const { svc, prisma } = build();
    prisma.puja.updateMany.mockResolvedValue({ count: 1 });
    prisma.auctionSession.findUnique.mockResolvedValue(activa());
    await svc.pujar('r1', 'p1', 90);
    const where = prisma.puja.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      proveedorId: 'p1',
      monto: { gt: 90 },
      session: { requerimientoId: 'r1', status: EstadoSubasta.ACTIVA },
    });
    expect(where.session.deadline.gt).toBeInstanceOf(Date);
  });

  it('rechaza montos no enteros o no positivos sin tocar la base', async () => {
    const { svc, prisma } = build();
    for (const monto of [0, -5, 10.5, Number.NaN]) {
      await expect(svc.pujar('r1', 'p1', monto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.puja.updateMany).not.toHaveBeenCalled();
  });

  it('explica por qué no se aceptó la puja', async () => {
    const { svc, prisma } = build();
    prisma.puja.updateMany.mockResolvedValue({ count: 0 });

    prisma.auctionSession.findUnique.mockResolvedValue(
      activa({ deadline: new Date(Date.now() - 1000) }),
    );
    await expect(svc.pujar('r1', 'p1', 90)).rejects.toThrow(
      'La ronda ya no está activa.',
    );

    prisma.auctionSession.findUnique.mockResolvedValue(activa({ pujas: [] }));
    await expect(svc.pujar('r1', 'p9', 90)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.auctionSession.findUnique.mockResolvedValue(activa());
    await expect(svc.pujar('r1', 'p1', 120)).rejects.toThrow(
      'menor a tu oferta actual',
    );
  });
});

describe('SubastaService.iniciar', () => {
  it('toma los participantes de las ofertas enviadas, no del navegador', async () => {
    const { svc, prisma } = build();
    prisma.auctionSession.findUnique.mockResolvedValue(null);
    prisma.oferta.findMany.mockResolvedValue([
      { proveedorId: 'p1', precioTotal: 100, proveedor: { nombre: 'Uno' } },
      { proveedorId: 'p2', precioTotal: 120, proveedor: { nombre: 'Dos' } },
    ]);
    await svc.iniciar('r1', { duracionMin: 30, participantes: 'finalistas' });
    expect(prisma.oferta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requerimientoId: 'r1', enviada: true },
        take: 3,
      }),
    );
    expect(prisma.puja.createMany.mock.calls[0][0].data).toEqual([
      {
        sessionId: 's1',
        proveedorId: 'p1',
        proveedorNombre: 'Uno',
        montoInicial: 100,
        monto: 100,
      },
      {
        sessionId: 's1',
        proveedorId: 'p2',
        proveedorNombre: 'Dos',
        montoInicial: 120,
        monto: 120,
      },
    ]);
  });

  it('no reinicia una ronda en curso ni acepta duraciones arbitrarias', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.iniciar('r1', { duracionMin: 5, participantes: 'todos' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.auctionSession.findUnique.mockResolvedValue(activa());
    await expect(
      svc.iniciar('r1', { duracionMin: 30, participantes: 'todos' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.puja.deleteMany).not.toHaveBeenCalled();
  });

  it('exige al menos dos ofertas', async () => {
    const { svc, prisma } = build();
    prisma.auctionSession.findUnique.mockResolvedValue(null);
    prisma.oferta.findMany.mockResolvedValue([
      { proveedorId: 'p1', precioTotal: 100, proveedor: { nombre: 'Uno' } },
    ]);
    await expect(
      svc.iniciar('r1', { duracionMin: 30, participantes: 'todos' }),
    ).rejects.toThrow('al menos 2');
  });
});

describe('SubastaService.getState', () => {
  it('cierra la ronda vencida al leerla', async () => {
    const { svc, prisma } = build();
    prisma.auctionSession.findUnique.mockResolvedValue(activa());
    await svc.getState('r1');
    expect(prisma.auctionSession.updateMany).toHaveBeenCalledWith({
      where: {
        requerimientoId: 'r1',
        status: EstadoSubasta.ACTIVA,
        deadline: { lte: expect.any(Date) },
      },
      data: { status: EstadoSubasta.CERRADA },
    });
  });
});
