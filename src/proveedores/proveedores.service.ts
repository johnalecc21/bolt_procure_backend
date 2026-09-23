import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHomologacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DOCUMENTOS_HOMOLOGACION_INICIALES } from '../homologacion/homologacion-documentos.const';
import type { UpdatePerfilDto } from './dto/update-perfil.dto';

const PALETTE = [
  'oklch(0.46 0.14 246)',
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
        // Only providers with an approved homologacion are visible/selectable here —
        // a provider stuck in zona gris or without homologacion has no business
        // being invited to bid, even though the invitation endpoint also enforces this.
        homologacion: { estado: EstadoHomologacion.APROBADO },
        ...(params?.categoria ? { categorias: { has: params.categoria } } : {}),
        ...(params?.minScore ? { score: { gte: params.minScore } } : {}),
        // Buyers search by what they need, not only by company name — so the
        // proveedor's own description and catalog items are searchable too.
        ...(params?.query
          ? {
              OR: [
                { nombre: { contains: params.query, mode: 'insensitive' } },
                { descripcion: { contains: params.query, mode: 'insensitive' } },
                { itemsCatalogo: { some: { nombre: { contains: params.query, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: { score: 'desc' },
      // The directory has no per-caller scope to bound it by (it's meant to
      // be browsed/filtered, not paged) — growth guard-rail, not page size.
      take: 200,
    });
  }

  async findOne(id: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { id },
      include: { homologacion: true },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado.');
    // Directory viewers (other companies, Interno) only need to know a
    // proveedor is homologado — alertas/nitDetectado are compliance-internal
    // detail, not something a competitor or a client shortlisting them should see.
    if (proveedor.homologacion) {
      const { alertas: _alertas, nitDetectado: _nitDetectado, ...homologacionPublica } = proveedor.homologacion;
      return { ...proveedor, homologacion: homologacionPublica };
    }
    return proveedor;
  }

  // Was independently copy-pasted (findUnique + throw NotFoundException) into
  // homologacion, contratos, invitaciones, ofertas, pagos and preguntas —
  // every one of them just needs the id, not the full profile findByUserId
  // below loads, so this is a lighter query as well as a single definition.
  async findIdForUser(userId: string): Promise<string> {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async findByUserId(userId: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { userId },
      include: { homologacion: true },
    });
    if (!proveedor) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return proveedor;
  }

  async actualizarMiPerfil(userId: string, dto: UpdatePerfilDto) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!proveedor) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return this.prisma.proveedorProfile.update({
      where: { userId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.categorias !== undefined ? { categorias: dto.categorias } : {}),
        ...(dto.ubicacion !== undefined ? { ubicacion: dto.ubicacion } : {}),
        ...(dto.sitioWeb !== undefined ? { sitioWeb: dto.sitioWeb.trim() || null } : {}),
        ...(dto.certificaciones !== undefined ? { certificaciones: dto.certificaciones } : {}),
      },
    });
  }

  async completarOnboarding(userId: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!proveedor) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return this.prisma.proveedorProfile.update({
      where: { userId },
      data: { onboardingCompletado: true },
    });
  }

  async createExterno(nombre: string) {
    const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
    return this.prisma.$transaction(async (tx) => {
      const proveedor = await tx.proveedorProfile.create({
        data: {
          nombre: nombre.trim(),
          iniciales: iniciales || 'PV',
          categorias: ['Pendiente de homologación'],
          ubicacion: 'Por confirmar',
          certificaciones: [],
          color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        },
      });
      await tx.homologacion.create({
        data: {
          proveedorId: proveedor.id,
          documentos: { create: DOCUMENTOS_HOMOLOGACION_INICIALES },
        },
      });
      return proveedor;
    });
  }
}
