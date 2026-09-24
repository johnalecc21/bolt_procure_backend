import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Moneda, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { formatMonto } from '../common/utils/moneda.util';
import { CentroCostoDto, UnidadNegocioDto } from './dto/estructura.dto';
import {
  calcularEjecucion,
  ESTADOS_EN_PROCESO,
  rangoAnio,
} from './presupuesto.util';

export interface EvaluacionPresupuesto {
  centroCosto: string;
  presupuesto: number;
  disponible: number;
  moneda: Moneda;
  excede: boolean;
}

/** Sedes / unidades de negocio, centros de costo and their annual budgets for one client company. */
@Injectable()
export class EstructuraService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async listar(companyId: string, anio = new Date().getFullYear()) {
    const [company, unidades, centros] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { exigeCentroCosto: true },
      }),
      this.prisma.unidadNegocio.findMany({
        where: { companyId },
        orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.centroCosto.findMany({
        where: { companyId },
        include: {
          presupuestos: { where: { anio } },
          unidadNegocio: { select: { nombre: true } },
        },
        orderBy: [{ activo: 'desc' }, { codigo: 'asc' }],
      }),
    ]);
    return {
      exigeCentroCosto: company.exigeCentroCosto,
      anio,
      unidades,
      centros: centros.map(({ presupuestos, ...c }) => ({
        ...c,
        presupuesto: presupuestos[0] ?? null,
      })),
    };
  }

  async actualizarConfig(
    companyId: string,
    exigeCentroCosto: boolean,
    actor: string,
  ) {
    if (exigeCentroCosto) {
      const activos = await this.prisma.centroCosto.count({
        where: { companyId, activo: true },
      });
      if (activos === 0)
        throw new BadRequestException(
          'Crea al menos un centro de costo activo antes de exigirlo.',
        );
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: { exigeCentroCosto },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Configuración de centros de costo actualizada',
      detalle: exigeCentroCosto
        ? 'Centro de costo obligatorio en requerimientos'
        : 'Centro de costo opcional',
    });
    return { exigeCentroCosto };
  }

  // --- Unidades ---------------------------------------------------------------

  async crearUnidad(companyId: string, dto: UnidadNegocioDto, actor: string) {
    const unidad = await this.conCodigoUnico(() =>
      this.prisma.unidadNegocio.create({
        data: {
          companyId,
          nombre: dto.nombre.trim(),
          codigo: dto.codigo.trim().toUpperCase(),
          tipo: dto.tipo,
          ciudad: dto.ciudad?.trim() || null,
        },
      }),
    );
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Unidad de negocio creada',
      detalle: `${unidad.codigo} — ${unidad.nombre}`,
    });
    return unidad;
  }

  async actualizarUnidad(
    companyId: string,
    id: string,
    dto: UnidadNegocioDto,
    actor: string,
  ) {
    await this.unidadDe(companyId, id);
    const unidad = await this.conCodigoUnico(() =>
      this.prisma.unidadNegocio.update({
        where: { id },
        data: {
          nombre: dto.nombre.trim(),
          codigo: dto.codigo.trim().toUpperCase(),
          ...(dto.tipo ? { tipo: dto.tipo } : {}),
          ciudad: dto.ciudad?.trim() || null,
          ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
        },
      }),
    );
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Unidad de negocio actualizada',
      detalle: `${unidad.codigo} — ${unidad.nombre}`,
    });
    return unidad;
  }

  // --- Centros de costo -------------------------------------------------------

  async crearCentro(companyId: string, dto: CentroCostoDto, actor: string) {
    const unidadNegocioId = await this.unidadOpcional(
      companyId,
      dto.unidadNegocioId,
    );
    const centro = await this.conCodigoUnico(() =>
      this.prisma.centroCosto.create({
        data: {
          companyId,
          nombre: dto.nombre.trim(),
          codigo: dto.codigo.trim().toUpperCase(),
          unidadNegocioId: unidadNegocioId ?? null,
          responsable: dto.responsable?.trim() || null,
        },
      }),
    );
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Centro de costo creado',
      detalle: `${centro.codigo} — ${centro.nombre}`,
    });
    return centro;
  }

  async actualizarCentro(
    companyId: string,
    id: string,
    dto: CentroCostoDto,
    actor: string,
  ) {
    await this.centroDe(companyId, id);
    const unidadNegocioId = await this.unidadOpcional(
      companyId,
      dto.unidadNegocioId,
    );
    const centro = await this.conCodigoUnico(() =>
      this.prisma.centroCosto.update({
        where: { id },
        data: {
          nombre: dto.nombre.trim(),
          codigo: dto.codigo.trim().toUpperCase(),
          ...(unidadNegocioId !== undefined ? { unidadNegocioId } : {}),
          responsable: dto.responsable?.trim() || null,
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
        },
      }),
    );
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Centro de costo actualizado',
      detalle: `${centro.codigo} — ${centro.nombre}`,
    });
    return centro;
  }

  async fijarPresupuesto(
    companyId: string,
    centroId: string,
    anio: number,
    monto: number,
    moneda: Moneda,
    actor: string,
  ) {
    const centro = await this.centroDe(companyId, centroId);
    const presupuesto = await this.prisma.presupuestoCentroCosto.upsert({
      where: { centroCostoId_anio: { centroCostoId: centroId, anio } },
      create: { centroCostoId: centroId, anio, monto, moneda },
      update: { monto, moneda },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: 'Presupuesto de centro de costo fijado',
      detalle: `${centro.codigo} ${anio}: ${formatMonto(monto, moneda)}`,
    });
    return presupuesto;
  }

  // --- Ejecución --------------------------------------------------------------

  /**
   * Budget execution per centro de costo for a year. Only amounts in the
   * budget's currency count (there's no FX source). POs issued under a
   * Contrato Marco are excluded — the marco's own monto already covers them.
   */
  async ejecucion(companyId: string, anio: number) {
    const centros = await this.prisma.centroCosto.findMany({
      where: { companyId },
      include: {
        presupuestos: { where: { anio } },
        unidadNegocio: { select: { nombre: true } },
      },
      orderBy: { codigo: 'asc' },
    });
    const filas = await Promise.all(
      centros.map(async (c) => {
        const presupuesto = c.presupuestos[0];
        if (!presupuesto) {
          return {
            centroCostoId: c.id,
            codigo: c.codigo,
            nombre: c.nombre,
            unidad: c.unidadNegocio?.nombre ?? null,
            activo: c.activo,
            moneda: null,
            ejecucion: null,
          };
        }
        const { comprometido, enProceso } = await this.consumo(
          c.id,
          anio,
          presupuesto.moneda,
        );
        return {
          centroCostoId: c.id,
          codigo: c.codigo,
          nombre: c.nombre,
          unidad: c.unidadNegocio?.nombre ?? null,
          activo: c.activo,
          moneda: presupuesto.moneda,
          ejecucion: calcularEjecucion(
            presupuesto.monto,
            comprometido,
            enProceso,
          ),
        };
      }),
    );
    return { anio, centros: filas };
  }

  /**
   * Validates the centro de costo chosen for a new requerimiento and checks
   * it against this year's budget. null = no budget to check against (none
   * set, or set in another currency).
   */
  async evaluarParaRequerimiento(
    companyId: string,
    centroCostoId: string | undefined,
    monto: number,
    moneda: Moneda,
  ): Promise<{
    centroCostoId: string | null;
    evaluacion: EvaluacionPresupuesto | null;
  }> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { exigeCentroCosto: true },
    });
    if (!centroCostoId) {
      if (company.exigeCentroCosto)
        throw new BadRequestException(
          'Tu empresa exige asignar un centro de costo a cada requerimiento.',
        );
      return { centroCostoId: null, evaluacion: null };
    }
    const centro = await this.prisma.centroCosto.findFirst({
      where: { id: centroCostoId, companyId, activo: true },
      include: { presupuestos: { where: { anio: new Date().getFullYear() } } },
    });
    if (!centro)
      throw new BadRequestException('Centro de costo no válido o inactivo.');
    const presupuesto = centro.presupuestos[0];
    if (!presupuesto || presupuesto.moneda !== moneda)
      return { centroCostoId, evaluacion: null };

    const { comprometido, enProceso } = await this.consumo(
      centro.id,
      presupuesto.anio,
      moneda,
    );
    const { disponible } = calcularEjecucion(
      presupuesto.monto,
      comprometido,
      enProceso,
    );
    return {
      centroCostoId,
      evaluacion: {
        centroCosto: `${centro.codigo} — ${centro.nombre}`,
        presupuesto: presupuesto.monto,
        disponible,
        moneda,
        excede: monto > disponible,
      },
    };
  }

  private async consumo(centroCostoId: string, anio: number, moneda: Moneda) {
    const rango = rangoAnio(anio);
    const [contratos, requerimientos] = await Promise.all([
      this.prisma.contrato.aggregate({
        where: {
          centroCostoId,
          moneda,
          contratoPadreId: null,
          createdAt: rango,
        },
        _sum: { monto: true },
      }),
      this.prisma.requerimiento.aggregate({
        where: {
          centroCostoId,
          moneda,
          estado: { in: ESTADOS_EN_PROCESO },
          // A split award signs one contract at a time: once any is signed
          // it counts as committed, so the estimate stops counting here.
          contratos: { none: {} },
          createdAt: rango,
        },
        _sum: { montoEstimado: true },
      }),
    ]);
    return {
      comprometido: contratos._sum.monto ?? 0,
      enProceso: requerimientos._sum.montoEstimado ?? 0,
    };
  }

  private async unidadDe(companyId: string, id: string) {
    const unidad = await this.prisma.unidadNegocio.findFirst({
      where: { id, companyId },
    });
    if (!unidad)
      throw new NotFoundException('Unidad de negocio no encontrada.');
    return unidad;
  }

  private async centroDe(companyId: string, id: string) {
    const centro = await this.prisma.centroCosto.findFirst({
      where: { id, companyId },
    });
    if (!centro) throw new NotFoundException('Centro de costo no encontrado.');
    return centro;
  }

  /** undefined = don't touch; "" = detach; an id = must belong to the company. */
  private async unidadOpcional(
    companyId: string,
    unidadId: string | undefined,
  ): Promise<string | null | undefined> {
    if (unidadId === undefined) return undefined;
    if (!unidadId) return null;
    await this.unidadDe(companyId, unidadId);
    return unidadId;
  }

  private async conCodigoUnico<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe otro registro con ese código.');
      }
      throw err;
    }
  }
}
