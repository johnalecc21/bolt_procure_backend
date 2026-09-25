import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHomologacion, Prisma } from '@prisma/client';
import { paginate } from '../common/dto/pagination.dto';
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

  private whereDirectorio(params?: {
    categoria?: string;
    minScore?: number;
    query?: string;
  }): Prisma.ProveedorProfileWhereInput {
    return {
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
              {
                itemsCatalogo: {
                  some: {
                    nombre: { contains: params.query, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  list(params?: { categoria?: string; minScore?: number; query?: string }) {
    return this.prisma.proveedorProfile.findMany({
      where: this.whereDirectorio(params),
      orderBy: { score: 'desc' },
      // The directory has no per-caller scope to bound it by — growth
      // guard-rail for the non-paginated callers (shortlist, dashboard).
      take: 200,
    });
  }

  /** Server-side paginated directory for the client portal. */
  async listPaginada(params: {
    page: number;
    limit: number;
    categoria?: string;
    minScore?: number;
    query?: string;
  }) {
    const where = this.whereDirectorio(params);
    const [items, total] = await Promise.all([
      this.prisma.proveedorProfile.findMany({
        where,
        orderBy: [{ score: 'desc' }, { nombre: 'asc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.proveedorProfile.count({ where }),
    ]);
    return paginate(items, total, params.page, params.limit);
  }

  /** Every category used by an approved proveedor — the directory's filter options. */
  async categorias(): Promise<string[]> {
    const filas = await this.prisma.proveedorProfile.findMany({
      where: { homologacion: { estado: EstadoHomologacion.APROBADO } },
      select: { categorias: true },
    });
    return [...new Set(filas.flatMap((f) => f.categorias))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
  }

  async findOne(id: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { id },
      include: {
        // Allowlist: any signed-in user (other companies, competing
        // proveedores, Interno) can open this profile. The questionnaire
        // (bank account, revenue, legal representative), the score breakdown,
        // compliance notes and alerts stay in /homologacion and the Interno queue.
        homologacion: {
          select: {
            id: true,
            estado: true,
            score: true,
            nivelRiesgo: true,
            fechaSolicitud: true,
            proximaRevalidacion: true,
          },
        },
      },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado.');
    return proveedor;
  }

  // Was independently copy-pasted (findUnique + throw NotFoundException) into
  // homologacion, contratos, invitaciones, ofertas, pagos and preguntas —
  // every one of them just needs the id, not the full profile findByUserId
  // below loads, so this is a lighter query as well as a single definition.
  async findIdForUser(userId: string): Promise<string> {
    const profile = await this.prisma.proveedorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile)
      throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async findByUserId(userId: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { userId },
      include: { homologacion: true },
    });
    if (!proveedor)
      throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return proveedor;
  }

  async actualizarMiPerfil(userId: string, dto: UpdatePerfilDto) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { userId },
    });
    if (!proveedor)
      throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return this.prisma.proveedorProfile.update({
      where: { userId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
        ...(dto.categorias !== undefined ? { categorias: dto.categorias } : {}),
        ...(dto.ubicacion !== undefined ? { ubicacion: dto.ubicacion } : {}),
        ...(dto.nit !== undefined ? { nit: dto.nit.trim() || null } : {}),
        ...(dto.sitioWeb !== undefined
          ? { sitioWeb: dto.sitioWeb.trim() || null }
          : {}),
        ...(dto.certificaciones !== undefined
          ? { certificaciones: dto.certificaciones }
          : {}),
      },
    });
  }

  async completarOnboarding(userId: string) {
    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { userId },
    });
    if (!proveedor)
      throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return this.prisma.proveedorProfile.update({
      where: { userId },
      data: { onboardingCompletado: true },
    });
  }

  async createExterno(nombre: string) {
    const iniciales = nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('');
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
