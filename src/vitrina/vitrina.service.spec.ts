import { BadRequestException } from '@nestjs/common';
import { VitrinaService } from './vitrina.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ProveedoresService } from '../proveedores/proveedores.service';

function build(counts: { archivos?: number; items?: number } = {}) {
  const prisma = {
    archivoVitrina: {
      count: jest.fn().mockResolvedValue(counts.archivos ?? 0),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'a1', ...data }),
        ),
    },
    itemCatalogo: {
      count: jest.fn().mockResolvedValue(counts.items ?? 0),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'i1', ...data }),
        ),
    },
  };
  const storage = {
    safeFilename: (f: string) => f.replace(/[^a-zA-Z0-9.\-_]/g, '_'),
    createUploadUrl: jest
      .fn()
      .mockImplementation((_b: string, path: string) =>
        Promise.resolve({ path, token: 't' }),
      ),
  };
  const proveedores = { findIdForUser: jest.fn().mockResolvedValue('P-1') };
  const svc = new VitrinaService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    proveedores as unknown as ProveedoresService,
  );
  return { svc, prisma, storage };
}

describe('VitrinaService', () => {
  it('signs uploads inside the proveedor folder for that use', async () => {
    const { svc } = build();
    const res = await svc.crearUrlSubida('u', {
      filename: 'Mi brochure.pdf',
      uso: 'BROCHURE',
    });
    expect(res.path).toMatch(/^P-1\/brochure\/\d+-Mi_brochure\.pdf$/);
  });

  it('rejects a wrong format before signing anything', async () => {
    const { svc, storage } = build();
    await expect(
      svc.crearUrlSubida('u', { filename: 'foto.pdf', uso: 'IMAGEN' }),
    ).rejects.toThrow(BadRequestException);
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses a path from another proveedor or another use', async () => {
    const { svc } = build();
    await expect(
      svc.crearArchivo('u', {
        tipo: 'IMAGEN',
        titulo: 'x',
        path: 'P-2/imagen/1-a.png',
      }),
    ).rejects.toThrow('Ruta de archivo inválida.');
    await expect(
      svc.crearArchivo('u', {
        tipo: 'IMAGEN',
        titulo: 'x',
        path: 'P-1/brochure/1-a.png',
      }),
    ).rejects.toThrow('Ruta de archivo inválida.');
  });

  it('enforces the per-type limit', async () => {
    const { svc } = build({ archivos: 20 });
    await expect(
      svc.crearArchivo('u', {
        tipo: 'IMAGEN',
        titulo: 'x',
        path: 'P-1/imagen/1-a.png',
      }),
    ).rejects.toThrow(/máximo de 20/);
  });

  it('creates catalog items with a validated photo and requires a currency for prices', async () => {
    const { svc } = build({ items: 3 });
    const item = await svc.crearItem('u', {
      nombre: ' Mantenimiento ',
      imagenPath: 'P-1/item/1-a.jpg',
      precioReferencia: 100,
      moneda: 'COP',
    });
    expect(item).toMatchObject({
      nombre: 'Mantenimiento',
      orden: 3,
      imagenPath: 'P-1/item/1-a.jpg',
      moneda: 'COP',
    });
    await expect(
      svc.crearItem('u', { nombre: 'Sin moneda', precioReferencia: 100 }),
    ).rejects.toThrow(/moneda/);
    await expect(
      svc.crearItem('u', {
        nombre: 'Foto ajena',
        imagenPath: 'P-9/item/1-a.jpg',
      }),
    ).rejects.toThrow('Ruta de imagen inválida.');
  });
});
