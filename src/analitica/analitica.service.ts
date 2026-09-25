import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoAprobacion, EstadoPago } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstructuraService } from '../estructura/estructura.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import {
  MAX_DIAS_PERIODO,
  MAX_FILAS,
  MAX_GRAFICAS_POR_USUARIO,
} from './analitica.const';
import { CrearGraficaDto, PeriodoAnaliticaDto } from './dto/analitica.dto';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → start of that day (UTC); the dashboard works at day granularity. */
function inicioDia(fecha: string) {
  return new Date(`${fecha.slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class AnaliticaService {
  constructor(
    private prisma: PrismaService,
    private estructura: EstructuraService,
  ) {}

  /**
   * Row-level dataset for the CFO dashboard. Every KPI, chart, table and
   * export on the frontend is computed from these same rows by one
   * aggregator, so the numbers can't disagree between views. It covers the
   * requested period plus an equally long window before it (for deltas).
   * Money is sent with its currency; the aggregator only sums the company's
   * base currency and reports how much was left out.
   */
  async cfo(companyId: string, periodo: PeriodoAnaliticaDto) {
    const hasta = periodo.hasta
      ? inicioDia(periodo.hasta)
      : inicioDia(new Date().toISOString());
    const hastaExclusivo = new Date(hasta.getTime() + MS_POR_DIA);
    const desde = periodo.desde
      ? inicioDia(periodo.desde)
      : new Date(
          Date.UTC(
            hasta.getUTCFullYear(),
            hasta.getUTCMonth() - 6,
            hasta.getUTCDate(),
          ),
        );
    if (desde >= hastaExclusivo)
      throw new BadRequestException(
        'La fecha inicial debe ser anterior a la final.',
      );
    const dias = Math.round(
      (hastaExclusivo.getTime() - desde.getTime()) / MS_POR_DIA,
    );
    if (dias > MAX_DIAS_PERIODO)
      throw new BadRequestException('El período máximo es de 3 años.');
    const desdeAnterior = new Date(desde.getTime() - dias * MS_POR_DIA);

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { monedaBase: true, pais: true, nombre: true },
    });

    const [procesos, contratos, pagos, hitos, evaluaciones] = await Promise.all(
      [
        this.procesos(companyId, desdeAnterior, hastaExclusivo),
        this.contratos(companyId, desdeAnterior, hastaExclusivo),
        this.pagos(companyId, desdeAnterior, hastaExclusivo),
        this.hitos(companyId, desdeAnterior, hastaExclusivo),
        this.evaluaciones(companyId, desdeAnterior, hastaExclusivo),
      ],
    );

    const anios = new Set<number>();
    for (let y = desde.getUTCFullYear(); y <= hasta.getUTCFullYear(); y++)
      anios.add(y);
    const presupuestos = await Promise.all(
      [...anios].map((anio) => this.estructura.ejecucion(companyId, anio)),
    );

    return {
      empresa: company.nombre,
      moneda: company.monedaBase,
      pais: company.pais,
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      desdeAnterior: desdeAnterior.toISOString().slice(0, 10),
      generadoEn: new Date().toISOString(),
      truncado: procesos.truncado || contratos.truncado,
      procesos: procesos.filas,
      contratos: contratos.filas,
      pagos,
      hitos,
      evaluaciones,
      presupuestos,
    };
  }

  /** Requerimientos created in the window, or signed in it (a process can start before the window). */
  private async procesos(companyId: string, desde: Date, hasta: Date) {
    const rows = await this.prisma.requerimiento.findMany({
      where: {
        companyId,
        OR: [
          { createdAt: { gte: desde, lt: hasta } },
          {
            contratos: {
              some: {
                createdAt: { gte: desde, lt: hasta },
                requerimientoId: { not: null },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_FILAS + 1,
      select: {
        id: true,
        numero: true,
        titulo: true,
        categoria: true,
        prioridad: true,
        estado: true,
        moneda: true,
        montoEstimado: true,
        createdAt: true,
        fechaLimite: true,
        centroCosto: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            unidadNegocio: { select: { id: true, nombre: true } },
          },
        },
        solicitante: { select: { nombre: true } },
        invitaciones: { where: { enviada: true }, select: { id: true } },
        ofertas: { where: { enviada: true }, select: { precioTotal: true } },
        aprobaciones: { select: { estado: true, resueltoAt: true } },
        adjudicaciones: {
          select: {
            proveedorId: true,
            precioFinal: true,
            firmado: true,
            createdAt: true,
          },
        },
        auctionSession: {
          select: { pujas: { select: { montoInicial: true, monto: true } } },
        },
        contratos: {
          where: { contratoPadreId: null },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, proveedorNombre: true },
        },
      },
    });
    const truncado = rows.length > MAX_FILAS;
    const filas = rows.slice(0, MAX_FILAS).map((r) => {
      const pujas = r.auctionSession?.pujas ?? [];
      const aprobada = r.aprobaciones.find(
        (a) => a.estado === EstadoAprobacion.APROBADA,
      );
      // A split award counts as signed once every proveedor's contract is.
      const adjs = r.adjudicaciones;
      const firma =
        adjs.length > 0 && adjs.every((a) => a.firmado)
          ? (r.contratos.at(-1)?.createdAt ?? null)
          : null;
      return {
        id: r.id,
        codigo: formatRequerimientoCodigo(r.numero),
        titulo: r.titulo,
        categoria: r.categoria,
        prioridad: r.prioridad,
        estado: r.estado,
        moneda: r.moneda,
        presupuesto: r.montoEstimado,
        creado: r.createdAt.toISOString(),
        cierreLicitacion: r.fechaLimite.toISOString(),
        aprobado: aprobada?.resueltoAt?.toISOString() ?? null,
        rechazos: r.aprobaciones.filter(
          (a) => a.estado === EstadoAprobacion.RECHAZADA,
        ).length,
        centroCostoId: r.centroCosto?.id ?? null,
        centroCosto: r.centroCosto
          ? `${r.centroCosto.codigo} — ${r.centroCosto.nombre}`
          : null,
        unidadId: r.centroCosto?.unidadNegocio?.id ?? null,
        unidad: r.centroCosto?.unidadNegocio?.nombre ?? null,
        solicitante: r.solicitante.nombre,
        invitados: r.invitaciones.length,
        ofertas: r.ofertas.length,
        mejorOferta: r.ofertas.length
          ? Math.min(...r.ofertas.map((o) => o.precioTotal))
          : null,
        negociado: pujas.length > 0,
        negociacionInicial: pujas.length
          ? Math.min(...pujas.map((p) => p.montoInicial))
          : null,
        negociacionFinal: pujas.length
          ? Math.min(...pujas.map((p) => p.monto))
          : null,
        proveedorAdjudicado: r.contratos.length
          ? r.contratos.map((c) => c.proveedorNombre).join(' + ')
          : null,
        precioFinal: adjs.length
          ? adjs.reduce((s, a) => s + a.precioFinal, 0)
          : null,
        firmado: firma?.toISOString() ?? null,
      };
    });
    return { filas, truncado };
  }

  /** Contracts and POs signed in the window, plus every one still in force (for renewals and exposure). */
  private async contratos(companyId: string, desde: Date, hasta: Date) {
    const rows = await this.prisma.contrato.findMany({
      where: {
        companyId,
        OR: [
          { createdAt: { gte: desde, lt: hasta } },
          { vigenciaFin: { gte: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_FILAS + 1,
      select: {
        id: true,
        numero: true,
        tipo: true,
        requerimientoId: true,
        contratoPadreId: true,
        proveedorNombre: true,
        categoria: true,
        monto: true,
        moneda: true,
        createdAt: true,
        vigenciaInicio: true,
        vigenciaFin: true,
        estado: true,
        centroCosto: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            unidadNegocio: { select: { id: true, nombre: true } },
          },
        },
      },
    });
    const truncado = rows.length > MAX_FILAS;
    const filas = rows.slice(0, MAX_FILAS).map((c) => ({
      id: c.id,
      codigo: formatContratoCodigo(c.tipo, c.numero),
      tipo: c.tipo,
      requerimientoId: c.requerimientoId,
      /** Set on POs issued against a contrato marco: its amount is already inside the parent's. */
      contratoPadreId: c.contratoPadreId,
      proveedor: c.proveedorNombre,
      categoria: c.categoria,
      monto: c.monto,
      moneda: c.moneda,
      firmado: c.createdAt.toISOString(),
      vigenciaInicio: c.vigenciaInicio.toISOString(),
      vigenciaFin: c.vigenciaFin.toISOString(),
      estado: c.estado,
      centroCostoId: c.centroCosto?.id ?? null,
      centroCosto: c.centroCosto
        ? `${c.centroCosto.codigo} — ${c.centroCosto.nombre}`
        : null,
      unidadId: c.centroCosto?.unidadNegocio?.id ?? null,
      unidad: c.centroCosto?.unidadNegocio?.nombre ?? null,
    }));
    return { filas, truncado };
  }

  /** Payments issued in the window plus every one still unpaid (cash exposure is a "today" figure). */
  private async pagos(companyId: string, desde: Date, hasta: Date) {
    const rows = await this.prisma.pagoPO.findMany({
      where: {
        contrato: { companyId },
        OR: [
          { fechaEmision: { gte: desde, lt: hasta } },
          { estado: { not: EstadoPago.PAGADO } },
        ],
      },
      orderBy: { fechaPagoPactada: 'asc' },
      take: MAX_FILAS,
      select: {
        id: true,
        monto: true,
        moneda: true,
        fechaEmision: true,
        fechaPagoPactada: true,
        estado: true,
        proveedor: { select: { nombre: true } },
        contrato: {
          select: {
            tipo: true,
            numero: true,
            categoria: true,
            centroCostoId: true,
          },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      contrato: formatContratoCodigo(p.contrato.tipo, p.contrato.numero),
      proveedor: p.proveedor.nombre,
      categoria: p.contrato.categoria,
      centroCostoId: p.contrato.centroCostoId,
      monto: p.monto,
      moneda: p.moneda,
      emision: p.fechaEmision.toISOString(),
      pactada: p.fechaPagoPactada.toISOString(),
      estado: p.estado,
    }));
  }

  /** Delivery milestones due in the window — the basis for on-time delivery. */
  private async hitos(companyId: string, desde: Date, hasta: Date) {
    const rows = await this.prisma.hitoSeguimiento.findMany({
      where: {
        contrato: { companyId },
        comprometido: { gte: desde, lt: hasta },
      },
      take: MAX_FILAS,
      select: {
        comprometido: true,
        real: true,
        estado: true,
        contrato: {
          select: {
            proveedorNombre: true,
            categoria: true,
            centroCostoId: true,
          },
        },
      },
    });
    return rows.map((h) => ({
      proveedor: h.contrato.proveedorNombre,
      categoria: h.contrato.categoria,
      centroCostoId: h.contrato.centroCostoId,
      comprometido: h.comprometido.toISOString(),
      real: h.real?.toISOString() ?? null,
      estado: h.estado,
    }));
  }

  private async evaluaciones(companyId: string, desde: Date, hasta: Date) {
    const rows = await this.prisma.evaluacionDesempeno.findMany({
      where: { companyId, createdAt: { gte: desde, lt: hasta } },
      take: MAX_FILAS,
      select: {
        puntaje: true,
        calidad: true,
        plazos: true,
        servicio: true,
        hse: true,
        requierePlanMejora: true,
        createdAt: true,
        proveedor: { select: { nombre: true } },
        contrato: { select: { categoria: true, centroCostoId: true } },
      },
    });
    return rows.map((e) => ({
      proveedor: e.proveedor.nombre,
      categoria: e.contrato.categoria,
      centroCostoId: e.contrato.centroCostoId,
      puntaje: e.puntaje,
      calidad: e.calidad,
      plazos: e.plazos,
      servicio: e.servicio,
      hse: e.hse,
      planMejora: e.requierePlanMejora,
      fecha: e.createdAt.toISOString(),
    }));
  }

  // --- Gráficas guardadas ----------------------------------------------------

  listarGraficas(companyId: string, userId: string) {
    return this.prisma.graficaGuardada.findMany({
      where: { companyId, userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        titulo: true,
        metrica: true,
        dimension: true,
        tipo: true,
        createdAt: true,
      },
    });
  }

  async crearGrafica(companyId: string, userId: string, dto: CrearGraficaDto) {
    const total = await this.prisma.graficaGuardada.count({
      where: { companyId, userId },
    });
    if (total >= MAX_GRAFICAS_POR_USUARIO) {
      throw new ConflictException(
        `Puedes guardar hasta ${MAX_GRAFICAS_POR_USUARIO} gráficas. Elimina alguna para crear otra.`,
      );
    }
    return this.prisma.graficaGuardada.create({
      data: {
        companyId,
        userId,
        titulo: dto.titulo.trim(),
        metrica: dto.metrica,
        dimension: dto.dimension,
        tipo: dto.tipo,
      },
      select: {
        id: true,
        titulo: true,
        metrica: true,
        dimension: true,
        tipo: true,
        createdAt: true,
      },
    });
  }

  async eliminarGrafica(companyId: string, userId: string, id: string) {
    const { count } = await this.prisma.graficaGuardada.deleteMany({
      where: { id, companyId, userId },
    });
    if (count === 0) throw new NotFoundException('Gráfica no encontrada.');
    return { ok: true };
  }
}
