import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHomologacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertOfertaDto } from './dto/upsert-oferta.dto';

@Injectable()
export class OfertasService {
  constructor(private prisma: PrismaService) {}

  listByRequerimiento(requerimientoId: string) {
    return this.prisma.oferta.findMany({
      where: { requerimientoId },
      include: { proveedor: true },
    });
  }

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async mine(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const oferta = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId, proveedorId } },
    });
    if (oferta) return oferta;
    // No Prisma record yet — return an explicit empty shape rather than null,
    // since NestJS sends a null/undefined response body as empty (Content-Length: 0),
    // which the frontend's `data ?? fallback` can't distinguish from a parse failure.
    return {
      precioUnitario: 0,
      precioTotal: 0,
      plazoEntregaDias: 0,
      condicionesPagoDias: 0,
      garantiaMeses: 0,
      vigenciaOfertaDias: 0,
      enviada: false,
    };
  }

  async upsert(userId: string, dto: UpsertOfertaDto) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const existing = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId: dto.requerimientoId, proveedorId } },
    });
    if (existing?.enviada) {
      throw new BadRequestException('Esta oferta ya fue enviada y no es editable.');
    }
    return this.prisma.oferta.upsert({
      where: { requerimientoId_proveedorId: { requerimientoId: dto.requerimientoId, proveedorId } },
      create: { ...dto, proveedorId },
      update: { ...dto },
    });
  }

  async enviar(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const homologacion = await this.prisma.homologacion.findUnique({ where: { proveedorId } });
    if (homologacion?.estado !== EstadoHomologacion.APROBADO) {
      throw new ForbiddenException('Tu homologación debe estar aprobada para poder enviar ofertas.');
    }
    const oferta = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId, proveedorId } },
    });
    if (!oferta) throw new NotFoundException('Aún no has completado tu oferta.');
    await this.prisma.$transaction([
      this.prisma.oferta.update({ where: { id: oferta.id }, data: { enviada: true } }),
      this.prisma.requerimiento.update({
        where: { id: requerimientoId },
        data: { ofertasRecibidas: { increment: 1 } },
      }),
    ]);
    return { ok: true };
  }

  async miHistorial(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const misOfertas = await this.prisma.oferta.findMany({
      where: { proveedorId, enviada: true },
      include: { requerimiento: { include: { company: true, adjudicacion: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const procesos = misOfertas.map((o) => {
      const adj = o.requerimiento.adjudicacion;
      let resultado: 'ganado' | 'perdido' | 'pendiente' = 'pendiente';
      let feedback: string | undefined;
      if (adj?.firmado) {
        resultado = adj.proveedorId === proveedorId ? 'ganado' : 'perdido';
        if (resultado === 'perdido') {
          feedback = 'El proceso fue adjudicado a otro proveedor con mejor relación precio-calidad.';
        }
      }
      return {
        id: o.id,
        requerimientoId: o.requerimientoId,
        titulo: o.requerimiento.titulo,
        cliente: o.requerimiento.company.nombre,
        fecha: o.createdAt,
        monto: o.precioTotal,
        resultado,
        feedback,
      };
    });

    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({ where: { id: proveedorId } });
    const miPromedio = misOfertas.length
      ? misOfertas.reduce((sum, o) => sum + o.precioTotal, 0) / misOfertas.length
      : 0;
    const mercado = await this.prisma.oferta.findMany({
      where: { enviada: true, requerimiento: { categoria: { in: proveedor.categorias } } },
      select: { precioTotal: true },
    });
    const mercadoPromedio = mercado.length
      ? mercado.reduce((sum, o) => sum + o.precioTotal, 0) / mercado.length
      : miPromedio;
    const tuOfertaPromedioVsMercado = mercadoPromedio
      ? Math.round(((miPromedio - mercadoPromedio) / mercadoPromedio) * 100)
      : 0;

    return { procesos, competitividad: { tuOfertaPromedioVsMercado } };
  }
}
