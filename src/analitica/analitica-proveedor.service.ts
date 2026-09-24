import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import {
  formatContratoCodigo,
  formatRequerimientoCodigo,
} from '../common/utils/codigo.util';
import { MAX_DIAS_PERIODO, MAX_FILAS } from './analitica.const';
import { calcularCompetencia } from './competencia.util';
import { PeriodoAnaliticaDto } from './dto/analitica.dto';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function inicioDia(fecha: string) {
  return new Date(`${fecha.slice(0, 10)}T00:00:00.000Z`);
}

type Resultado =
  'ganado' | 'perdido' | 'seleccionado' | 'pendiente' | 'sin_oferta';

@Injectable()
export class AnaliticaProveedorService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
  ) {}

  /**
   * The supplier's own rows for its "Mi desempeño" dashboard: every process it
   * was invited to, its contracts, payments, milestones and evaluations, for
   * the period plus an equally long one before it. Nothing about other
   * suppliers leaves the server except, for lost processes of buyers that
   * enabled it, the price rank and the gap to the awarded price.
   */
  async datos(userId: string, periodo: PeriodoAnaliticaDto) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
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
    const ventana = { gte: desdeAnterior, lt: hastaExclusivo };

    const proveedor = await this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id: proveedorId },
      select: { nombre: true, vitrinaVistas: true },
    });

    const esMio = { requerimiento: { adjudicacion: { proveedorId } } };
    const [invitaciones, contratos, pagos, hitos, evaluaciones] =
      await Promise.all([
        this.prisma.invitacion.findMany({
          where: {
            proveedorId,
            enviada: true,
            OR: [
              { createdAt: ventana },
              {
                requerimiento: { contratos: { some: { createdAt: ventana } } },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_FILAS + 1,
          select: {
            createdAt: true,
            estado: true,
            requerimiento: {
              select: {
                id: true,
                numero: true,
                titulo: true,
                categoria: true,
                moneda: true,
                fechaLimite: true,
                company: {
                  select: { nombre: true, feedbackCompetitivo: true },
                },
                ofertas: {
                  where: { enviada: true },
                  select: {
                    proveedorId: true,
                    precioTotal: true,
                    createdAt: true,
                  },
                },
                auctionSession: {
                  select: {
                    pujas: { select: { proveedorId: true, monto: true } },
                  },
                },
                adjudicacion: {
                  select: {
                    proveedorId: true,
                    precioFinal: true,
                    confirmada: true,
                    firmado: true,
                    createdAt: true,
                  },
                },
                contratos: {
                  where: { contratoPadreId: null },
                  orderBy: { createdAt: 'asc' },
                  take: 1,
                  select: { createdAt: true },
                },
              },
            },
          },
        }),
        this.prisma.contrato.findMany({
          where: {
            OR: [esMio, { padre: esMio }],
            AND: [
              {
                OR: [
                  { createdAt: ventana },
                  { vigenciaFin: { gte: new Date() } },
                ],
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_FILAS,
          select: {
            id: true,
            tipo: true,
            numero: true,
            contratoPadreId: true,
            categoria: true,
            monto: true,
            moneda: true,
            createdAt: true,
            vigenciaFin: true,
            estado: true,
            company: { select: { nombre: true } },
          },
        }),
        this.prisma.pagoPO.findMany({
          where: {
            proveedorId,
            OR: [{ fechaEmision: ventana }, { estado: { not: 'PAGADO' } }],
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
            contrato: {
              select: {
                tipo: true,
                numero: true,
                categoria: true,
                company: { select: { nombre: true } },
              },
            },
          },
        }),
        this.prisma.hitoSeguimiento.findMany({
          where: {
            comprometido: ventana,
            contrato: { OR: [esMio, { padre: esMio }] },
          },
          take: MAX_FILAS,
          select: {
            comprometido: true,
            real: true,
            estado: true,
            contrato: {
              select: {
                categoria: true,
                company: { select: { nombre: true } },
              },
            },
          },
        }),
        this.prisma.evaluacionDesempeno.findMany({
          where: { proveedorId, createdAt: ventana },
          take: MAX_FILAS,
          select: {
            puntaje: true,
            calidad: true,
            plazos: true,
            servicio: true,
            hse: true,
            requierePlanMejora: true,
            createdAt: true,
            contrato: { select: { categoria: true, tipo: true, numero: true } },
            company: { select: { nombre: true } },
          },
        }),
      ]);

    const procesos = invitaciones
      .slice(0, MAX_FILAS)
      .flatMap((inv) =>
        inv.requerimiento ? [{ ...inv, requerimiento: inv.requerimiento }] : [],
      )
      .map((inv) => {
        const r = inv.requerimiento;
        const miOferta = r.ofertas.find((o) => o.proveedorId === proveedorId);
        const pujas = r.auctionSession?.pujas ?? [];
        const miPuja = pujas.find((p) => p.proveedorId === proveedorId);
        const adj = r.adjudicacion;
        let resultado: Resultado = miOferta ? 'pendiente' : 'sin_oferta';
        if (miOferta && adj?.firmado)
          resultado = adj.proveedorId === proveedorId ? 'ganado' : 'perdido';
        else if (miOferta && adj?.confirmada && adj.proveedorId === proveedorId)
          resultado = 'seleccionado';
        const fechaResultado = adj?.firmado
          ? (r.contratos[0]?.createdAt ?? adj.createdAt)
          : null;
        const competencia =
          resultado === 'perdido' && r.company.feedbackCompetitivo && adj
            ? calcularCompetencia(
                r.ofertas.map((o) => ({
                  proveedorId: o.proveedorId,
                  precio: o.precioTotal,
                })),
                pujas.map((p) => ({
                  proveedorId: p.proveedorId,
                  precio: p.monto,
                })),
                proveedorId,
                adj.precioFinal,
              )
            : null;
        return {
          requerimientoId: r.id,
          codigo: formatRequerimientoCodigo(r.numero),
          titulo: r.titulo,
          cliente: r.company.nombre,
          categoria: r.categoria,
          moneda: r.moneda,
          invitado: inv.createdAt.toISOString(),
          cierre: r.fechaLimite.toISOString(),
          declinada: inv.estado === 'DECLINADA',
          ofertaEnviada: !!miOferta,
          fechaOferta: miOferta?.createdAt.toISOString() ?? null,
          miPrecio: miOferta?.precioTotal ?? null,
          negociado: !!miPuja,
          miPrecioFinal: miPuja?.monto ?? miOferta?.precioTotal ?? null,
          resultado,
          fechaResultado: fechaResultado?.toISOString() ?? null,
          precioAdjudicado:
            resultado === 'ganado' || resultado === 'seleccionado'
              ? (adj?.precioFinal ?? null)
              : null,
          competenciaVisible:
            resultado === 'perdido' ? r.company.feedbackCompetitivo : null,
          posicion: competencia?.posicion ?? null,
          participantes: competencia?.participantes ?? null,
          brechaPct: competencia?.brechaPct ?? null,
        };
      });

    return {
      proveedor: proveedor.nombre,
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      desdeAnterior: desdeAnterior.toISOString().slice(0, 10),
      generadoEn: new Date().toISOString(),
      truncado: invitaciones.length > MAX_FILAS,
      visitasVitrina: proveedor.vitrinaVistas,
      procesos,
      contratos: contratos.map((c) => ({
        id: c.id,
        codigo: formatContratoCodigo(c.tipo, c.numero),
        contratoPadreId: c.contratoPadreId,
        cliente: c.company.nombre,
        categoria: c.categoria,
        monto: c.monto,
        moneda: c.moneda,
        firmado: c.createdAt.toISOString(),
        vigenciaFin: c.vigenciaFin.toISOString(),
        estado: c.estado,
      })),
      pagos: pagos.map((p) => ({
        id: p.id,
        contrato: formatContratoCodigo(p.contrato.tipo, p.contrato.numero),
        cliente: p.contrato.company.nombre,
        categoria: p.contrato.categoria,
        monto: p.monto,
        moneda: p.moneda,
        emision: p.fechaEmision.toISOString(),
        pactada: p.fechaPagoPactada.toISOString(),
        estado: p.estado,
      })),
      hitos: hitos.map((h) => ({
        cliente: h.contrato.company.nombre,
        categoria: h.contrato.categoria,
        comprometido: h.comprometido.toISOString(),
        real: h.real?.toISOString() ?? null,
        estado: h.estado,
      })),
      evaluaciones: evaluaciones.map((e) => ({
        cliente: e.company.nombre,
        categoria: e.contrato.categoria,
        contrato: formatContratoCodigo(e.contrato.tipo, e.contrato.numero),
        puntaje: e.puntaje,
        calidad: e.calidad,
        plazos: e.plazos,
        servicio: e.servicio,
        hse: e.hse,
        planMejora: e.requierePlanMejora,
        fecha: e.createdAt.toISOString(),
      })),
    };
  }
}
