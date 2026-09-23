import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoDocumento, EstadoHomologacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdatePerfilDto } from './dto/update-perfil.dto';
import { DOCUMENTOS_BASE } from '../homologacion/documentos-base';

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
        ...(params?.query
          ? { nombre: { contains: params.query, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { score: 'desc' },
      // The directory has no per-caller scope to bound it by (it's meant to
      // be browsed/filtered, not paged) — growth guard-rail, not page size.
      take: 200,
    });
  }

  /**
   * Only what a prospective client should see before any contact: no
   * contacts, alertas, NIT or document files — just the verified facts.
   */
  async vitrina(id: string) {
    const proveedor = await this.prisma.proveedorProfile.findFirst({
      where: { id, homologacion: { estado: EstadoHomologacion.APROBADO } },
      include: {
        homologacion: {
          select: {
            score: true,
            proximaRevalidacion: true,
            documentos: {
              where: { estado: EstadoDocumento.VALIDADO },
              select: { categoria: true, vigencia: true },
            },
          },
        },
      },
    });
    if (!proveedor) throw new NotFoundException('Proveedor no encontrado.');
    const ahora = new Date();
    const categoriasVerificadas = [
      ...new Set(
        proveedor.homologacion!.documentos.filter((d) => !d.vigencia || d.vigencia > ahora).map((d) => d.categoria),
      ),
    ];
    return {
      id: proveedor.id,
      nombre: proveedor.nombre,
      iniciales: proveedor.iniciales,
      color: proveedor.color,
      categorias: proveedor.categorias,
      ubicacion: proveedor.ubicacion,
      certificaciones: proveedor.certificaciones,
      score: proveedor.score,
      procesosGanados: proveedor.procesosGanados,
      entregasATiempo: proveedor.entregasATiempo,
      desempenoPromedio: proveedor.desempenoPromedio,
      evaluacionesCount: proveedor.evaluacionesCount,
      homologadoHasta: proveedor.homologacion!.proximaRevalidacion,
      categoriasVerificadas,
      miembroDesde: proveedor.createdAt,
    };
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
        documentos: { create: DOCUMENTOS_BASE },
      },
    });
    return proveedor;
  }
}
