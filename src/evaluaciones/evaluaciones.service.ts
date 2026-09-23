import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { formatContratoCodigo } from '../common/utils/codigo.util';
import { CreateEvaluacionDto } from './dto/create-evaluacion.dto';
import { calcularPuntaje, UMBRAL_PLAN_MEJORA } from './puntaje.util';

@Injectable()
export class EvaluacionesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
    private proveedores: ProveedoresService,
  ) {}

  async create(
    companyId: string,
    evaluadorId: string,
    actorNombre: string,
    dto: CreateEvaluacionDto,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: dto.contratoId, companyId },
      include: {
        requerimiento: {
          select: { adjudicacion: { select: { proveedorId: true } } },
        },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    // POs under a Contrato Marco copy the padre's requerimientoId, so this
    // resolves for them too.
    const proveedorId = contrato.requerimiento?.adjudicacion?.proveedorId;
    if (!proveedorId) {
      throw new BadRequestException(
        'Este contrato no está vinculado a un proveedor de la plataforma.',
      );
    }

    const puntaje = calcularPuntaje(dto);
    const requierePlanMejora = puntaje < UMBRAL_PLAN_MEJORA;

    const evaluacion = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.evaluacionDesempeno.create({
        data: {
          companyId,
          contratoId: contrato.id,
          proveedorId,
          evaluadorId,
          calidad: dto.calidad,
          plazos: dto.plazos,
          servicio: dto.servicio,
          hse: dto.hse,
          puntaje,
          comentario: dto.comentario,
          requierePlanMejora,
        },
      });
      const agg = await tx.evaluacionDesempeno.aggregate({
        where: { proveedorId },
        _avg: { puntaje: true },
        _count: true,
      });
      await tx.proveedorProfile.update({
        where: { id: proveedorId },
        data: {
          desempenoPromedio:
            agg._avg.puntaje !== null
              ? Math.round(agg._avg.puntaje * 10) / 10
              : null,
          evaluacionesCount: agg._count,
        },
      });
      return creada;
    });

    const codigo = formatContratoCodigo(contrato.tipo, contrato.numero);
    await this.auditLog.log({
      companyId,
      usuarioId: evaluadorId,
      usuario: actorNombre,
      accion: 'Evaluación de desempeño registrada',
      detalle: `${codigo} — ${contrato.proveedorNombre}: ${puntaje}/100${requierePlanMejora ? ' (requiere plan de mejora)' : ''}`,
    });

    const proveedor = await this.prisma.proveedorProfile.findUnique({
      where: { id: proveedorId },
      select: { userId: true },
    });
    if (proveedor?.userId) {
      await this.notificaciones.create(
        proveedor.userId,
        'CONTRATO',
        requierePlanMejora
          ? 'Evaluación de desempeño: se requiere plan de mejora'
          : 'Nueva evaluación de desempeño',
        requierePlanMejora
          ? `Tu desempeño en ${codigo} obtuvo ${puntaje}/100, por debajo de ${UMBRAL_PLAN_MEJORA}. Coordina un plan de mejora con tu cliente.`
          : `Tu desempeño en ${codigo} obtuvo ${puntaje}/100.`,
        '/proveedor/historial',
      );
    }
    return evaluacion;
  }

  listByContrato(companyId: string, contratoId: string) {
    return this.prisma.evaluacionDesempeno.findMany({
      where: { contratoId, companyId },
      include: { evaluador: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Network-wide averages (every client that evaluated this proveedor feeds
   * them — that's the value of a shared supplier base), but comments only
   * from the caller's own company.
   */
  async resumenProveedor(companyId: string, proveedorId: string) {
    const [agg, propias] = await Promise.all([
      this.prisma.evaluacionDesempeno.aggregate({
        where: { proveedorId },
        _avg: {
          puntaje: true,
          calidad: true,
          plazos: true,
          servicio: true,
          hse: true,
        },
        _count: true,
      }),
      this.prisma.evaluacionDesempeno.findMany({
        where: { proveedorId, companyId },
        include: {
          evaluador: { select: { nombre: true } },
          contrato: { select: { tipo: true, numero: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      total: agg._count,
      promedio: agg._avg.puntaje,
      porCriterio: {
        calidad: agg._avg.calidad,
        plazos: agg._avg.plazos,
        servicio: agg._avg.servicio,
        hse: agg._avg.hse,
      },
      propias: propias.map(({ contrato, ...e }) => ({
        ...e,
        contratoCodigo: formatContratoCodigo(contrato.tipo, contrato.numero),
      })),
    };
  }

  /** The proveedor's own evaluations — with the client's name, not the individual evaluator's. */
  async mias(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const evaluaciones = await this.prisma.evaluacionDesempeno.findMany({
      where: { proveedorId },
      include: {
        company: { select: { nombre: true } },
        contrato: { select: { tipo: true, numero: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return evaluaciones.map((e) => ({
      id: e.id,
      calidad: e.calidad,
      plazos: e.plazos,
      servicio: e.servicio,
      hse: e.hse,
      puntaje: e.puntaje,
      comentario: e.comentario,
      requierePlanMejora: e.requierePlanMejora,
      createdAt: e.createdAt,
      cliente: e.company.nombre,
      contratoCodigo: formatContratoCodigo(e.contrato.tipo, e.contrato.numero),
    }));
  }
}
