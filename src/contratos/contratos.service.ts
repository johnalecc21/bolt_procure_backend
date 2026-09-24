import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPago,
  Portal,
  Prisma,
  TipoContrato,
  TipoModificacion,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  SeguimientoService,
  vistaHito,
} from '../seguimiento/seguimiento.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import { EmitirPoDto } from './dto/emitir-po.dto';
import {
  CambiarMontoDto,
  ProrrogarDto,
  TerminarDto,
} from './dto/modificar-contrato.dto';
import { formatMonto } from '../common/utils/moneda.util';
import { PlanesService } from '../planes/planes.service';
import { paginate } from '../common/dto/pagination.dto';
import { estadoEfectivo } from '../pagos/pagos.rules';
import {
  esMarco,
  estadoPorVigencia,
  ESTADOS_OPERATIVOS,
  porcentajeAsignado,
  saldoMarco,
} from './contratos.rules';

const BUCKET = 'contratos-documentos';
const MS_DIA = 86_400_000;
const fechaCorta = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the contract page shows, in one query. */
const INCLUDE_FICHA = {
  company: { select: { nombre: true } },
  proveedor: { select: { id: true, nombre: true } },
  centroCosto: { select: { codigo: true, nombre: true } },
  hitos: { orderBy: { orden: 'asc' } },
  hijas: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      numero: true,
      tipo: true,
      monto: true,
      estado: true,
      vigenciaInicio: true,
      vigenciaFin: true,
      pagos: { select: { monto: true, estado: true } },
    },
  },
  padre: {
    select: {
      id: true,
      numero: true,
      tipo: true,
      monto: true,
      vigenciaFin: true,
      hijas: { select: { monto: true } },
      adjudicacion: {
        select: {
          garantiaMeses: true,
          plazoDias: true,
          poId: true,
          lineas: { include: { item: true } },
        },
      },
    },
  },
  requerimiento: {
    select: { id: true, numero: true, titulo: true, descripcion: true },
  },
  adjudicacion: {
    select: {
      garantiaMeses: true,
      plazoDias: true,
      poId: true,
      lineas: { include: { item: true } },
    },
  },
  pagos: {
    orderBy: { fechaEmision: 'asc' },
    include: {
      facturas: { orderBy: { createdAt: 'desc' }, take: 1 },
      hitoOrigen: { select: { label: true } },
    },
  },
  modificaciones: { orderBy: { createdAt: 'desc' } },
  versiones: { orderBy: { createdAt: 'desc' } },
  evaluaciones: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      puntaje: true,
      calidad: true,
      plazos: true,
      servicio: true,
      hse: true,
      comentario: true,
      requierePlanMejora: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ContratoInclude;

type ContratoFicha = Prisma.ContratoGetPayload<{
  include: typeof INCLUDE_FICHA;
}>;

@Injectable()
export class ContratosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private proveedores: ProveedoresService,
    private storage: StorageService,
    private planes: PlanesService,
    private notificaciones: NotificacionesService,
    private seguimiento: SeguimientoService,
  ) {}

  /** Server-side paginated list for the Contratos screen. */
  async listPaginada(
    companyId: string,
    params: {
      page: number;
      limit: number;
      q?: string;
      categoria?: string;
      estado?: EstadoContrato;
    },
  ) {
    const q = params.q?.trim();
    const numero = q?.match(/^(?:CTO-|PO-|ADD-)?0*(\d+)$/i)?.[1];
    const where: Prisma.ContratoWhereInput = {
      companyId,
      ...(params.categoria && params.categoria !== 'Todas'
        ? { categoria: params.categoria }
        : {}),
      ...(params.estado ? { estado: params.estado } : {}),
      ...(q
        ? {
            OR: [
              { proveedorNombre: { contains: q, mode: 'insensitive' } },
              { categoria: { contains: q, mode: 'insensitive' } },
              ...(numero ? [{ numero: Number(numero) }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.contrato.findMany({
        where,
        orderBy: { vigenciaFin: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          hijas: { select: { id: true, monto: true, estado: true } },
          centroCosto: { select: { codigo: true, nombre: true } },
          padre: { select: { id: true, numero: true, tipo: true } },
        },
      }),
      this.prisma.contrato.count({ where }),
    ]);
    return paginate(
      items.map((c) => ({
        ...c,
        esMarco: esMarco(c),
        saldoMarco: esMarco(c) ? saldoMarco(c.monto, c.hijas) : null,
        padreCodigo: c.padre
          ? formatContratoCodigo(c.padre.tipo, c.padre.numero)
          : null,
      })),
      total,
      params.page,
      params.limit,
    );
  }

  /** Every category the company has contracts in (the list filter). */
  async categorias(companyId: string) {
    const rows = await this.prisma.contrato.findMany({
      where: { companyId },
      distinct: ['categoria'],
      select: { categoria: true },
      orderBy: { categoria: 'asc' },
    });
    return rows.map((r) => r.categoria);
  }

  /** Contracts still in force, for the expiry reminders strip. */
  list(companyId: string) {
    return this.prisma.contrato.findMany({
      where: { companyId, estado: { in: ESTADOS_OPERATIVOS } },
      orderBy: { vigenciaFin: 'asc' },
      take: 200,
      select: {
        id: true,
        numero: true,
        tipo: true,
        proveedorNombre: true,
        categoria: true,
        monto: true,
        moneda: true,
        vigenciaInicio: true,
        vigenciaFin: true,
        estado: true,
        companyId: true,
        archivoNombre: true,
        condicionesPagoDias: true,
      },
    });
  }

  async findOne(companyId: string, id: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, companyId },
      include: INCLUDE_FICHA,
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return this.ficha(contrato, true);
  }

  async findOneMine(userId: string, id: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, proveedorId },
      include: INCLUDE_FICHA,
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return this.ficha(contrato, false);
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const contratos = await this.prisma.contrato.findMany({
      where: { proveedorId },
      orderBy: { vigenciaFin: 'asc' },
      include: {
        hitos: { orderBy: { orden: 'asc' } },
        company: true,
        requerimiento: { select: { titulo: true, descripcion: true } },
        adjudicacion: { select: { garantiaMeses: true, plazoDias: true } },
      },
      take: 200,
    });
    const ahora = new Date();
    return contratos.map(({ adjudicacion, ...c }) => ({
      ...c,
      esMarco: esMarco(c),
      hitos: c.hitos.map((h) => vistaHito(h, ahora)),
      requerimiento: c.requerimiento
        ? { ...c.requerimiento, adjudicacion }
        : null,
    }));
  }

  /**
   * The contract page: terms, what was awarded, milestones, payments, POs (and
   * the ceiling left on a marco), amendments, document versions and reviews.
   * The proveedor gets the same minus the buyer-internal parts.
   */
  private ficha(c: ContratoFicha, interno: boolean) {
    const ahora = new Date();
    const marco = esMarco(c);
    const adj = c.adjudicacion ?? c.padre?.adjudicacion ?? null;
    const pagos = c.pagos.map((p) => ({
      id: p.id,
      concepto: p.hitoOrigen?.label ?? null,
      monto: p.monto,
      montoNeto: p.monto - p.descuentoProntoPago,
      estado: estadoEfectivo(p.estado, p.fechaPagoPactada, ahora),
      fechaPagoPactada: p.fechaPagoPactada,
      fechaPago: p.fechaPago,
      factura: p.facturas[0]
        ? { numero: p.facturas[0].numero, estado: p.facturas[0].estado }
        : null,
    }));
    const pagado = c.pagos
      .filter((p) => p.estado === EstadoPago.PAGADO)
      .reduce((s, p) => s + (p.montoPagado ?? p.monto), 0);
    const liberado = c.pagos.reduce((s, p) => s + p.monto, 0);
    const {
      hitos,
      hijas,
      padre,
      requerimiento,
      modificaciones,
      versiones,
      evaluaciones,
    } = c;
    const base = {
      id: c.id,
      numero: c.numero,
      companyId: c.companyId,
      tipo: c.tipo,
      estado: c.estado,
      proveedorId: c.proveedorId,
      proveedorNombre: c.proveedorNombre,
      categoria: c.categoria,
      monto: c.monto,
      moneda: c.moneda,
      centroCosto: c.centroCosto,
      vigenciaInicio: c.vigenciaInicio,
      vigenciaFin: c.vigenciaFin,
      condicionesPagoDias: c.condicionesPagoDias,
      archivoNombre: c.archivoNombre,
      terminadoAt: c.terminadoAt,
      motivoTerminacion: c.motivoTerminacion,
      contratoPadreId: c.contratoPadreId,
      createdAt: c.createdAt,
    };
    return {
      ...base,
      codigo: formatContratoCodigo(c.tipo, c.numero),
      cliente: c.company.nombre,
      esMarco: marco,
      operativo: ESTADOS_OPERATIVOS.includes(c.estado),
      saldoMarco: marco ? saldoMarco(c.monto, hijas) : null,
      porcentajeAsignado: porcentajeAsignado(hitos),
      hitos: hitos.map((h) => vistaHito(h, ahora)),
      hijas: hijas.map((h) => ({
        id: h.id,
        codigo: formatContratoCodigo(h.tipo, h.numero),
        monto: h.monto,
        estado: h.estado,
        vigenciaInicio: h.vigenciaInicio,
        vigenciaFin: h.vigenciaFin,
        pagado: h.pagos
          .filter((p) => p.estado === EstadoPago.PAGADO)
          .reduce((s, p) => s + p.monto, 0),
      })),
      padre: padre
        ? {
            id: padre.id,
            codigo: formatContratoCodigo(padre.tipo, padre.numero),
            monto: padre.monto,
            vigenciaFin: padre.vigenciaFin,
            saldo: saldoMarco(padre.monto, padre.hijas),
          }
        : null,
      // Kept under requerimiento.adjudicacion: the PDF template reads it there.
      requerimiento: requerimiento
        ? {
            ...requerimiento,
            codigo: formatRequerimientoCodigo(requerimiento.numero),
            adjudicacion: adj
              ? { garantiaMeses: adj.garantiaMeses, plazoDias: adj.plazoDias }
              : null,
          }
        : null,
      // The award's PO number belongs to the contract it produced, not to POs issued under it.
      poId: c.adjudicacion?.poId ?? null,
      // Awarded lines only belong to the contract that was awarded — not to
      // each PO under a marco.
      lineas: (c.adjudicacion?.lineas ?? [])
        .sort((a, b) => a.item.orden - b.item.orden)
        .map((l) => ({
          descripcion: l.item.descripcion,
          unidad: l.item.unidad,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          subtotal: l.subtotal,
        })),
      pagos,
      resumenPagos: { liberado, pagado, pendiente: liberado - pagado },
      modificaciones,
      versiones: interno
        ? versiones.map((v) => ({
            id: v.id,
            nombre: v.nombre,
            tamanoBytes: v.tamanoBytes,
            subidoPor: v.subidoPor,
            createdAt: v.createdAt,
          }))
        : [],
      evaluaciones: interno ? evaluaciones : [],
    };
  }

  private async contratoDeEmpresa(companyId: string, id: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, companyId },
      include: {
        hijas: { select: { monto: true } },
        padre: { include: { hijas: { select: { monto: true } } } },
      },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }

  /** Row lock for the rest of the transaction (serializes ceiling checks). */
  private async bloquear(tx: Prisma.TransactionClient, contratoId: string) {
    await tx.$queryRaw`SELECT id FROM contratos WHERE id = ${contratoId} FOR UPDATE`;
  }

  private async notificarProveedor(
    proveedorId: string | null,
    titulo: string,
    desc: string,
    contratoId: string,
  ) {
    if (!proveedorId) return;
    const p = await this.prisma.proveedorProfile.findUnique({
      where: { id: proveedorId },
      select: { userId: true },
    });
    if (p?.userId)
      await this.notificaciones.create(
        p.userId,
        'CONTRATO',
        titulo,
        desc,
        `/proveedor/contratos/${contratoId}`,
      );
  }

  /**
   * A purchase order against a Contrato Marco: within its remaining ceiling
   * and validity, inheriting its supplier and payment terms. It is born with a
   * 100% delivery milestone (editable), so it's what actually gets paid.
   */
  async emitirPo(
    companyId: string,
    contratoPadreId: string,
    dto: EmitirPoDto,
    actorNombre: string,
  ) {
    const padre = await this.contratoDeEmpresa(companyId, contratoPadreId);
    if (!esMarco(padre)) {
      throw new BadRequestException(
        'Solo se pueden emitir POs bajo un Contrato Marco.',
      );
    }
    if (!ESTADOS_OPERATIVOS.includes(padre.estado)) {
      throw new ConflictException(
        'El Contrato Marco no está vigente: prorrógalo antes de emitir más POs.',
      );
    }
    const inicio = new Date(dto.vigenciaInicio);
    const fin = new Date(dto.vigenciaFin);
    if (fin <= inicio)
      throw new BadRequestException(
        'La vigencia fin debe ser posterior al inicio.',
      );
    if (
      fin > padre.vigenciaFin ||
      inicio < new Date(fechaCorta(padre.vigenciaInicio))
    )
      throw new BadRequestException(
        `La PO debe quedar dentro de la vigencia del marco (${fechaCorta(padre.vigenciaInicio)} a ${fechaCorta(padre.vigenciaFin)}).`,
      );
    const adj = await this.prisma.adjudicacion.findUnique({
      where: { contratoId: padre.id },
      select: { plazoDias: true },
    });
    const entrega = new Date(
      Math.min(
        fin.getTime(),
        inicio.getTime() + (adj?.plazoDias ?? 30) * MS_DIA,
      ),
    );

    const po = await this.prisma.$transaction(async (tx) => {
      // Lock the marco and re-read its ceiling: two POs at once can't both
      // take the last of it.
      await this.bloquear(tx, padre.id);
      const hijas = await tx.contrato.findMany({
        where: { contratoPadreId: padre.id },
        select: { monto: true },
      });
      const saldo = saldoMarco(padre.monto, hijas);
      if (dto.monto > saldo)
        throw new BadRequestException(
          `El monto supera el saldo del Contrato Marco (${formatMonto(saldo, padre.moneda)}).`,
        );
      const po = await tx.contrato.create({
        data: {
          companyId,
          requerimientoId: padre.requerimientoId,
          tipo: TipoContrato.PO,
          proveedorId: padre.proveedorId,
          proveedorNombre: padre.proveedorNombre,
          categoria: padre.categoria,
          monto: dto.monto,
          moneda: padre.moneda,
          centroCostoId: padre.centroCostoId,
          condicionesPagoDias: padre.condicionesPagoDias,
          vigenciaInicio: inicio,
          vigenciaFin: fin,
          estado: estadoPorVigencia(fin),
          contratoPadreId: padre.id,
        },
      });
      await tx.hitoSeguimiento.create({
        data: {
          contratoId: po.id,
          label: 'Entrega',
          comprometido: entrega,
          orden: 0,
          porcentaje: 100,
        },
      });
      return po;
    });
    const codigo = formatContratoCodigo(po.tipo, po.numero);
    const codigoPadre = formatContratoCodigo(padre.tipo, padre.numero);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'PO emitida bajo Contrato Marco',
      detalle: `${codigo} bajo ${codigoPadre} — ${formatMonto(dto.monto, padre.moneda)}`,
    });
    await this.notificarProveedor(
      padre.proveedorId,
      'Nueva orden de compra',
      `${codigo} por ${formatMonto(dto.monto, padre.moneda)} bajo ${codigoPadre}, con entrega comprometida el ${fechaCorta(entrega)}.`,
      po.id,
    );
    return po;
  }

  /** Extends the validity; an expired contract comes back to life. */
  async prorrogar(
    companyId: string,
    id: string,
    dto: ProrrogarDto,
    actorNombre: string,
  ) {
    const c = await this.contratoDeEmpresa(companyId, id);
    if (c.estado === EstadoContrato.TERMINADO)
      throw new ConflictException(
        'Un contrato terminado no se puede prorrogar.',
      );
    const nueva = new Date(dto.vigenciaFin);
    if (nueva <= c.vigenciaFin)
      throw new BadRequestException(
        'La nueva fecha debe ser posterior a la vigencia actual.',
      );
    if (c.padre && nueva > c.padre.vigenciaFin)
      throw new BadRequestException(
        `Una PO no puede ir más allá de su Contrato Marco (${fechaCorta(c.padre.vigenciaFin)}). Prorroga primero el marco.`,
      );
    await this.prisma.$transaction([
      this.prisma.contrato.update({
        where: { id },
        data: {
          vigenciaFin: nueva,
          estado: estadoPorVigencia(nueva),
          // The reminders start over for the new end date.
          recordatorio60Enviado: false,
          recordatorio30Enviado: false,
          recordatorio15Enviado: false,
        },
      }),
      this.prisma.modificacionContrato.create({
        data: {
          contratoId: id,
          tipo: TipoModificacion.PRORROGA,
          motivo: dto.motivo.trim(),
          vigenciaAntes: c.vigenciaFin,
          vigenciaDespues: nueva,
          usuario: actorNombre,
        },
      }),
    ]);
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Contrato prorrogado',
      detalle: `${codigo}: ${fechaCorta(c.vigenciaFin)} → ${fechaCorta(nueva)} (${dto.motivo.trim()})`,
    });
    await this.notificarProveedor(
      c.proveedorId,
      'Contrato prorrogado',
      `${codigo} ahora vence el ${fechaCorta(nueva)}.`,
      id,
    );
    return this.findOne(companyId, id);
  }

  /**
   * Changes the contract value. It can't go below what's already committed:
   * the POs issued (marco) or the payments already released.
   */
  async cambiarMonto(
    companyId: string,
    id: string,
    dto: CambiarMontoDto,
    actorNombre: string,
  ) {
    const c = await this.contratoDeEmpresa(companyId, id);
    if (
      !ESTADOS_OPERATIVOS.includes(c.estado) &&
      c.estado !== EstadoContrato.VENCIDO
    )
      throw new ConflictException(
        'Un contrato terminado no se puede modificar.',
      );
    if (dto.monto === c.monto)
      throw new BadRequestException('El monto nuevo es igual al actual.');
    const liberado = await this.prisma.pagoPO.aggregate({
      where: { contratoId: id },
      _sum: { monto: true },
    });
    const minimo = esMarco(c)
      ? c.hijas.reduce((s, h) => s + h.monto, 0)
      : (liberado._sum.monto ?? 0);
    if (dto.monto < minimo)
      throw new BadRequestException(
        `No puede quedar por debajo de lo ya comprometido (${formatMonto(minimo, c.moneda)}).`,
      );
    await this.prisma.$transaction(async (tx) => {
      if (c.padre) {
        await this.bloquear(tx, c.padre.id);
        const hermanas = await tx.contrato.findMany({
          where: { contratoPadreId: c.padre.id },
          select: { monto: true },
        });
        const saldoPadre = saldoMarco(c.padre.monto, hermanas);
        if (dto.monto - c.monto > saldoPadre)
          throw new BadRequestException(
            `El aumento supera el saldo del Contrato Marco (${formatMonto(saldoPadre, c.moneda)}).`,
          );
      }
      await tx.contrato.update({ where: { id }, data: { monto: dto.monto } });
      await tx.modificacionContrato.create({
        data: {
          contratoId: id,
          tipo: TipoModificacion.MONTO,
          motivo: dto.motivo.trim(),
          montoAntes: c.monto,
          montoDespues: dto.monto,
          usuario: actorNombre,
        },
      });
    });
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Monto del contrato modificado',
      detalle: `${codigo}: ${formatMonto(c.monto, c.moneda)} → ${formatMonto(dto.monto, c.moneda)} (${dto.motivo.trim()})`,
    });
    await this.notificarProveedor(
      c.proveedorId,
      'Monto del contrato modificado',
      `${codigo} pasó de ${formatMonto(c.monto, c.moneda)} a ${formatMonto(dto.monto, c.moneda)}: ${dto.motivo.trim()}.`,
      id,
    );
    return this.findOne(companyId, id);
  }

  /**
   * Ends the contract early. Payments already released are still owed; the
   * pending milestones stop (they won't release payments) and a marco can't
   * take new POs. The purchase process closes if nothing else is pending.
   */
  async terminar(
    companyId: string,
    id: string,
    dto: TerminarDto,
    actorNombre: string,
  ) {
    const c = await this.contratoDeEmpresa(companyId, id);
    const { count } = await this.prisma.contrato.updateMany({
      where: { id, estado: { not: EstadoContrato.TERMINADO } },
      data: {
        estado: EstadoContrato.TERMINADO,
        terminadoAt: new Date(),
        motivoTerminacion: dto.motivo.trim(),
      },
    });
    if (count === 0)
      throw new ConflictException('El contrato ya estaba terminado.');
    await this.prisma.modificacionContrato.create({
      data: {
        contratoId: id,
        tipo: TipoModificacion.TERMINACION,
        motivo: dto.motivo.trim(),
        vigenciaAntes: c.vigenciaFin,
        usuario: actorNombre,
      },
    });
    const codigo = formatContratoCodigo(c.tipo, c.numero);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Contrato terminado anticipadamente',
      detalle: `${codigo} (${c.proveedorNombre}): ${dto.motivo.trim()}`,
    });
    await this.notificarProveedor(
      c.proveedorId,
      'Contrato terminado',
      `${codigo} fue terminado por el cliente: ${dto.motivo.trim()}. Los pagos ya liberados se mantienen.`,
      id,
    );
    if (c.requerimientoId)
      await this.seguimiento.cerrarSiCompleto(
        companyId,
        c.requerimientoId,
        actorNombre,
      );
    return this.findOne(companyId, id);
  }

  async reportarAvance(
    userId: string,
    contratoId: string,
    hitoId: string,
    nota: string,
  ) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contratoId, contrato: { proveedorId } },
      select: { id: true },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    return this.seguimiento.reportarAvance(userId, proveedorId, hitoId, nota);
  }

  // Only the company that owns the contrato can attach their own PO/contract
  // file. Each upload is a new version; the latest is the one downloaded.
  async crearUrlSubida(
    companyId: string,
    id: string,
    filename: string,
    tamanoBytes?: number,
  ) {
    await this.contratoDeEmpresa(companyId, id);
    if (tamanoBytes)
      await this.planes.verificarAlmacenamiento(companyId, tamanoBytes);
    const path = `${companyId}/${id}/${Date.now()}-${this.storage.safeFilename(filename)}`;
    return this.storage.createUploadUrl(BUCKET, path);
  }

  async adjuntarArchivo(
    companyId: string,
    id: string,
    path: string,
    nombre: string,
    actorNombre: string,
    tamanoBytes?: number,
  ) {
    await this.contratoDeEmpresa(companyId, id);
    if (!path.startsWith(`${companyId}/${id}/`)) {
      throw new BadRequestException('Ruta de archivo inválida.');
    }
    const [actualizado] = await this.prisma.$transaction([
      this.prisma.contrato.update({
        where: { id },
        data: {
          archivoStoragePath: path,
          archivoNombre: nombre,
          archivoTamanoBytes: tamanoBytes ?? null,
        },
      }),
      this.prisma.versionDocumentoContrato.create({
        data: {
          contratoId: id,
          nombre,
          storagePath: path,
          tamanoBytes: tamanoBytes ?? null,
          subidoPor: actorNombre,
        },
      }),
    ]);
    const versiones = await this.prisma.versionDocumentoContrato.count({
      where: { contratoId: id },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Documento propio adjuntado a contrato',
      detalle: `${formatContratoCodigo(actualizado.tipo, actualizado.numero)} — ${nombre} (versión ${versiones})`,
    });
    return actualizado;
  }

  /** Cliente can fetch a link for any contrato in their company; proveedor only for their own (current version). */
  async crearUrlDescarga(
    portal: Portal,
    companyIdOrUserId: string,
    id: string,
  ) {
    const contrato =
      portal === Portal.PROVEEDOR
        ? await this.prisma.contrato.findFirst({
            where: {
              id,
              proveedorId:
                await this.proveedores.findIdForUser(companyIdOrUserId),
            },
          })
        : await this.prisma.contrato.findFirst({
            where: { id, companyId: companyIdOrUserId },
          });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    if (!contrato.archivoStoragePath)
      throw new NotFoundException(
        'Este contrato no tiene un documento propio adjunto.',
      );

    const { url } = await this.storage.createDownloadUrl(
      BUCKET,
      contrato.archivoStoragePath,
    );
    return { url, nombre: contrato.archivoNombre };
  }

  async urlVersion(companyId: string, id: string, versionId: string) {
    const version = await this.prisma.versionDocumentoContrato.findFirst({
      where: { id: versionId, contratoId: id, contrato: { companyId } },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    const { url } = await this.storage.createDownloadUrl(
      BUCKET,
      version.storagePath,
    );
    return { url, nombre: version.nombre };
  }
}
