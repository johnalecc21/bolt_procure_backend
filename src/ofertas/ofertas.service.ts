import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHomologacion, EstadoInvitacion } from '@prisma/client';
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

  // The provider's own in-progress board: every proceso they've accepted to
  // bid on (declined/not-yet-accepted invitations don't belong here — those
  // live in Bandeja de Invitaciones), paired with whatever offer state they
  // have for it, draft or already sent. Also picks up any oferta row that
  // exists without a matching accepted invitación — shouldn't normally
  // happen, but a provider with a real offer on file should never be told
  // there's nothing to see.
  async listMine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const [invitacionesAceptadas, ofertas] = await Promise.all([
      this.prisma.invitacion.findMany({
        where: {
          proveedorId,
          enviada: true,
          estado: { in: [EstadoInvitacion.VISTA, EstadoInvitacion.RESPONDIDA] },
        },
        include: { company: true, requerimiento: { select: { titulo: true, categoria: true } } },
      }),
      this.prisma.oferta.findMany({
        where: { proveedorId },
        include: { requerimiento: { include: { company: true } } },
      }),
    ]);

    const porRequerimiento = new Map<
      string,
      { requerimientoId: string; titulo: string; cliente: string; categoria: string; fechaLimite: Date; oferta: { enviada: boolean; precioTotal: number } | null }
    >();
    for (const inv of invitacionesAceptadas) {
      if (!inv.requerimientoId) continue;
      porRequerimiento.set(inv.requerimientoId, {
        requerimientoId: inv.requerimientoId,
        titulo: inv.requerimiento?.titulo ?? '',
        cliente: inv.company.nombre,
        categoria: inv.requerimiento?.categoria ?? inv.categoria,
        fechaLimite: inv.fechaLimite,
        oferta: null,
      });
    }
    for (const o of ofertas) {
      porRequerimiento.set(o.requerimientoId, {
        requerimientoId: o.requerimientoId,
        titulo: o.requerimiento.titulo,
        cliente: o.requerimiento.company.nombre,
        categoria: o.requerimiento.categoria,
        fechaLimite: o.requerimiento.fechaLimite,
        oferta: { enviada: o.enviada, precioTotal: o.precioTotal },
      });
    }
    return Array.from(porRequerimiento.values()).sort(
      (a, b) => a.fechaLimite.getTime() - b.fechaLimite.getTime(),
    );
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
      let resultado: 'ganado' | 'perdido' | 'pendiente' | 'seleccionado' = 'pendiente';
      let feedback: string | undefined;
      if (adj?.firmado) {
        resultado = adj.proveedorId === proveedorId ? 'ganado' : 'perdido';
        if (resultado === 'perdido') {
          feedback = 'El proceso fue adjudicado a otro proveedor con mejor relación precio-calidad.';
        }
      } else if (adj?.confirmada && adj.proveedorId === proveedorId) {
        // Chosen, but the contract/PO hasn't been signed yet — a real interim
        // state, not just "pendiente" like every other unresolved process.
        resultado = 'seleccionado';
      }
      const awardTerms =
        (resultado === 'seleccionado' || resultado === 'ganado') && adj
          ? {
              poId: adj.poId,
              precioFinal: adj.precioFinal,
              plazoDias: adj.plazoDias,
              condicionesPagoDias: adj.condicionesPagoDias,
              garantiaMeses: adj.garantiaMeses,
            }
          : {};
      return {
        id: o.id,
        requerimientoId: o.requerimientoId,
        titulo: o.requerimiento.titulo,
        cliente: o.requerimiento.company.nombre,
        fecha: o.createdAt,
        monto: o.precioTotal,
        resultado,
        feedback,
        ...awardTerms,
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
