import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PALETTE = [
  'oklch(0.60 0.22 280)',
  'oklch(0.60 0.18 155)',
  'oklch(0.70 0.18 68)',
  'oklch(0.65 0.20 200)',
];

@Injectable()
export class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  list(params?: { categoria?: string; minScore?: number; query?: string }) {
    return this.prisma.proveedorProfile.findMany({
      where: {
        ...(params?.categoria ? { categorias: { has: params.categoria } } : {}),
        ...(params?.minScore ? { score: { gte: params.minScore } } : {}),
        ...(params?.query
          ? { nombre: { contains: params.query, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { score: 'desc' },
    });
  }

  async findOne(id: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { id },
      include: { homologacion: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado.');
    return proveedor;
  }

  async createExterno(nombre: string) {
    const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
    const proveedor = await this.prisma.proveedorProfile.create({
      data: {
        nombre: nombre.trim(),
        iniciales: iniciales || 'PV',
        categorias: ['Pendiente de homologación'],
        ubicacion: 'Por confirmar',
        certificaciones: [],
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      },
    });
    await this.prisma.homologacion.create({
      data: {
        proveedorId: proveedor.id,
        documentos: {
          create: [
            { nombre: 'RUT / NIT' },
            { nombre: 'Estados financieros' },
            { nombre: 'Certificado ISO / BASC / ESG' },
            { nombre: 'Referencias comerciales' },
          ],
        },
      },
    });
    return proveedor;
  }
}
