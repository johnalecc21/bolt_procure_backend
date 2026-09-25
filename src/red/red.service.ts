import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoHomologacion,
  EstadoInvitacion,
  EstadoRequerimiento,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { formatRequerimientoCodigo } from '../common/utils/codigo.util';
import {
  categoriasFaltantes,
  esElegible,
} from '../homologacion/requisitos.util';

const POR_PAGINA = 24;
const MAX_AVISOS = 500;

const normal = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * The supplier network: a buyer can open a tender to every homologated
 * supplier of its category ("convocatoria abierta"), suppliers find those
 * opportunities and join them with the homologación they already have, and
 * a public directory shows who is in the network.
 */
@Injectable()
export class RedService {
  private readonly logger = new Logger(RedService.name);

  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
    private notificaciones: NotificacionesService,
    private auditLog: AuditLogService,
  ) {}

  // ------------------------------------------------------------- comprador

  /**
   * Tells the homologated suppliers of the category that the tender is open
   * to them. Called when an open tender starts, or when a running one is
   * opened. Never throws: the tender is already live.
   */
  async publicar(requerimientoId: string) {
    try {
      const r = await this.prisma.requerimiento.findUnique({
        where: { id: requerimientoId },
        select: {
          id: true,
          titulo: true,
          categoria: true,
          abiertoRed: true,
          estado: true,
          companyId: true,
          fechaLimite: true,
          company: {
            select: { nombre: true, categoriasHomologacionRequeridas: true },
          },
          invitaciones: { select: { proveedorId: true } },
        },
      });
      if (!r?.abiertoRed || r.estado !== EstadoRequerimiento.EN_LICITACION)
        return 0;
      const ya = new Set(r.invitaciones.map((i) => i.proveedorId));
      const candidatos = await this.prisma.proveedorProfile.findMany({
        where: {
          homologacion: { estado: EstadoHomologacion.APROBADO },
          userId: { not: null },
          id: { notIn: [...ya] },
        },
        select: {
          id: true,
          categorias: true,
          user: { select: { id: true } },
          homologacion: { include: { documentos: true } },
        },
        take: 5000,
      });
      const cat = normal(r.categoria);
      const destinatarios = candidatos
        .filter((p) => p.categorias.some((c) => normal(c) === cat))
        .filter((p) =>
          esElegible(
            p.homologacion,
            r.company.categoriasHomologacionRequeridas,
          ),
        )
        .slice(0, MAX_AVISOS);
      for (const p of destinatarios)
        await this.notificaciones.create(
          p.user!.id,
          'PROVEEDOR',
          'Nueva oportunidad en tu categoría',
          `${r.company.nombre} abrió "${r.titulo}" a la red de proveedores homologados. Puedes participar hasta el ${r.fechaLimite.toISOString().slice(0, 10)}.`,
          '/proveedor/oportunidades',
        );
      return destinatarios.length;
    } catch (err) {
      this.logger.error(
        `No se pudo publicar ${requerimientoId} en la red`,
        err instanceof Error ? err.stack : err,
      );
      return 0;
    }
  }

  /** Opens (or closes) a running tender to the network. */
  async abrir(
    companyId: string,
    requerimientoId: string,
    abierto: boolean,
    actor: string,
  ) {
    const r = await this.prisma.requerimiento.findFirst({
      where: { id: requerimientoId, companyId },
      select: {
        id: true,
        estado: true,
        titulo: true,
        abiertoRed: true,
        fechaLimite: true,
      },
    });
    if (!r) throw new NotFoundException('Requerimiento no encontrado.');
    if (
      abierto &&
      (r.estado !== EstadoRequerimiento.EN_LICITACION ||
        r.fechaLimite <= new Date())
    )
      throw new BadRequestException(
        'Solo se puede abrir a la red un proceso que está recibiendo ofertas.',
      );
    await this.prisma.requerimiento.update({
      where: { id: r.id },
      data: { abiertoRed: abierto },
    });
    await this.auditLog.log({
      companyId,
      usuario: actor,
      accion: abierto
        ? 'Proceso abierto a la red de proveedores'
        : 'Proceso cerrado a la red',
      detalle: r.titulo,
    });
    const avisados = abierto && !r.abiertoRed ? await this.publicar(r.id) : 0;
    return { abiertoRed: abierto, avisados };
  }

  /**
   * Live tender board: where each supplier is (opened, accepted, preparing
   * the offer, sent, declined) and when it last did something. No prices.
   */
  async tablero(companyId: string, requerimientoId: string) {
    const r = await this.prisma.requerimiento.findFirst({
      where: { id: requerimientoId, companyId },
      select: {
        id: true,
        estado: true,
        fechaLimite: true,
        abiertoRed: true,
        createdAt: true,
        invitaciones: {
          where: { enviada: true },
          select: {
            id: true,
            proveedorId: true,
            estado: true,
            origen: true,
            vistaAt: true,
            respondidaAt: true,
            createdAt: true,
            proveedor: {
              select: { nombre: true, score: true, ubicacion: true },
            },
          },
        },
        ofertas: {
          select: {
            proveedorId: true,
            enviada: true,
            enviadaAt: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        preguntas: { select: { proveedorId: true, createdAt: true } },
      },
    });
    if (!r) throw new NotFoundException('Requerimiento no encontrado.');
    const oferta = new Map(r.ofertas.map((o) => [o.proveedorId, o]));
    const preguntas = new Map<string, Date[]>();
    for (const q of r.preguntas)
      preguntas.set(q.proveedorId, [
        ...(preguntas.get(q.proveedorId) ?? []),
        q.createdAt,
      ]);
    const filas = r.invitaciones.map((i) => {
      const o = oferta.get(i.proveedorId);
      const qs = preguntas.get(i.proveedorId) ?? [];
      const etapa = o?.enviada
        ? 'OFERTA_ENVIADA'
        : i.estado === EstadoInvitacion.DECLINADA
          ? 'DECLINO'
          : o
            ? 'PREPARANDO'
            : i.estado === EstadoInvitacion.VISTA ||
                i.estado === EstadoInvitacion.RESPONDIDA
              ? 'ACEPTO'
              : i.vistaAt
                ? 'VIO'
                : 'SIN_ABRIR';
      const fechas = [
        i.createdAt,
        i.vistaAt,
        i.respondidaAt,
        o?.updatedAt,
        o?.enviadaAt,
        ...qs,
      ].filter((d): d is Date => !!d);
      return {
        proveedorId: i.proveedorId,
        proveedor: i.proveedor.nombre,
        score: i.proveedor.score,
        ubicacion: i.proveedor.ubicacion,
        origen: i.origen,
        etapa,
        invitadoAt: i.createdAt,
        vistaAt: i.vistaAt,
        respondidaAt: i.respondidaAt,
        borradorAt: o && !o.enviada ? o.updatedAt : null,
        enviadaAt: o?.enviada ? (o.enviadaAt ?? o.updatedAt) : null,
        preguntas: qs.length,
        ultimaActividad: new Date(Math.max(...fechas.map((d) => d.getTime()))),
      };
    });
    const orden = [
      'OFERTA_ENVIADA',
      'PREPARANDO',
      'ACEPTO',
      'VIO',
      'SIN_ABRIR',
      'DECLINO',
    ];
    filas.sort(
      (a, b) =>
        orden.indexOf(a.etapa) - orden.indexOf(b.etapa) ||
        b.ultimaActividad.getTime() - a.ultimaActividad.getTime(),
    );
    const cuenta = (e: string[]) =>
      filas.filter((f) => e.includes(f.etapa)).length;
    return {
      estado: r.estado,
      fechaLimite: r.fechaLimite,
      abiertoRed: r.abiertoRed,
      publicado: r.createdAt,
      ahora: new Date(),
      resumen: {
        participantes: filas.length,
        vieron: cuenta(['VIO', 'ACEPTO', 'PREPARANDO', 'OFERTA_ENVIADA']),
        aceptaron: cuenta(['ACEPTO', 'PREPARANDO', 'OFERTA_ENVIADA']),
        preparando: cuenta(['PREPARANDO']),
        enviaron: cuenta(['OFERTA_ENVIADA']),
        declinaron: cuenta(['DECLINO']),
        desdeRed: filas.filter((f) => f.origen === 'RED').length,
        preguntas: r.preguntas.length,
      },
      filas,
    };
  }

  // ------------------------------------------------------------- proveedor

  private async proveedorConHomologacion(userId: string) {
    const id = await this.proveedores.findIdForUser(userId);
    return this.prisma.proveedorProfile.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        nombre: true,
        categorias: true,
        homologacion: { include: { documentos: true } },
      },
    });
  }

  /**
   * Open tenders a supplier can join. By default only its categories; with
   * `todas` every open tender (it may still be unable to join some).
   */
  async oportunidades(userId: string, opts: { todas?: boolean; q?: string }) {
    const p = await this.proveedorConHomologacion(userId);
    const cats = new Set(p.categorias.map(normal));
    const abiertos = await this.prisma.requerimiento.findMany({
      where: {
        abiertoRed: true,
        estado: EstadoRequerimiento.EN_LICITACION,
        fechaLimite: { gt: new Date() },
        ...(opts.q?.trim()
          ? {
              OR: [
                { titulo: { contains: opts.q.trim(), mode: 'insensitive' } },
                { categoria: { contains: opts.q.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        numero: true,
        titulo: true,
        categoria: true,
        moneda: true,
        fechaLimite: true,
        createdAt: true,
        descripcion: true,
        company: {
          select: { nombre: true, categoriasHomologacionRequeridas: true },
        },
        invitaciones: {
          where: { proveedorId: p.id },
          select: { id: true, estado: true },
        },
        _count: { select: { items: true, invitaciones: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const homologado = p.homologacion?.estado === EstadoHomologacion.APROBADO;
    return {
      homologado,
      categorias: p.categorias,
      items: abiertos
        .filter((r) => opts.todas || cats.has(normal(r.categoria)))
        .map((r) => {
          const faltan = categoriasFaltantes(
            p.homologacion,
            r.company.categoriasHomologacionRequeridas,
          );
          const participa = r.invitaciones[0] ?? null;
          return {
            id: r.id,
            codigo: formatRequerimientoCodigo(r.numero),
            titulo: r.titulo,
            descripcion: r.descripcion?.slice(0, 280) ?? null,
            categoria: r.categoria,
            cliente: r.company.nombre,
            moneda: r.moneda,
            fechaLimite: r.fechaLimite,
            publicado: r.createdAt,
            items: r._count.items,
            participantes: r._count.invitaciones,
            deMiCategoria: cats.has(normal(r.categoria)),
            participa: participa ? { estado: participa.estado } : null,
            puedeParticipar: homologado && faltan.length === 0,
            motivo: !homologado
              ? 'Tu homologación debe estar aprobada.'
              : faltan.length
                ? `Esta empresa exige documentos validados de: ${faltan.join(', ')}.`
                : null,
          };
        }),
    };
  }

  /** The supplier joins an open tender with the homologación it already has. */
  async participar(userId: string, requerimientoId: string) {
    const p = await this.proveedorConHomologacion(userId);
    const r = await this.prisma.requerimiento.findUnique({
      where: { id: requerimientoId },
      select: {
        id: true,
        titulo: true,
        categoria: true,
        abiertoRed: true,
        estado: true,
        fechaLimite: true,
        companyId: true,
        solicitanteId: true,
        company: { select: { categoriasHomologacionRequeridas: true } },
      },
    });
    if (!r || !r.abiertoRed)
      throw new NotFoundException('Este proceso no está abierto a la red.');
    if (
      r.estado !== EstadoRequerimiento.EN_LICITACION ||
      r.fechaLimite <= new Date()
    )
      throw new BadRequestException('Este proceso ya no recibe ofertas.');
    if (
      !esElegible(p.homologacion, r.company.categoriasHomologacionRequeridas)
    ) {
      const faltan = categoriasFaltantes(
        p.homologacion,
        r.company.categoriasHomologacionRequeridas,
      );
      throw new BadRequestException(
        p.homologacion?.estado !== EstadoHomologacion.APROBADO
          ? 'Tu homologación debe estar aprobada para participar.'
          : `Esta empresa exige documentos validados de: ${faltan.join(', ')}.`,
      );
    }
    const ahora = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const ya = await tx.invitacion.findFirst({
          where: { requerimientoId: r.id, proveedorId: p.id },
        });
        if (ya) {
          if (ya.estado === EstadoInvitacion.DECLINADA)
            await tx.invitacion.update({
              where: { id: ya.id },
              data: { estado: EstadoInvitacion.VISTA, respondidaAt: ahora },
            });
          else throw new ConflictException('Ya participas en este proceso.');
          return;
        }
        await tx.invitacion.create({
          data: {
            companyId: r.companyId,
            proveedorId: p.id,
            requerimientoId: r.id,
            categoria: r.categoria,
            fechaLimite: r.fechaLimite,
            enviada: true,
            origen: 'RED',
            estado: EstadoInvitacion.VISTA,
            vistaAt: ahora,
            respondidaAt: ahora,
          },
        });
        await tx.requerimiento.update({
          where: { id: r.id },
          data: { proveedoresInvitados: { increment: 1 } },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new ConflictException('Ya participas en este proceso.');
      throw err;
    }
    await this.auditLog.log({
      companyId: r.companyId,
      usuario: p.nombre,
      accion: 'Proveedor se unió desde la red',
      detalle: r.titulo,
    });
    await this.notificaciones.create(
      r.solicitanteId,
      'OFERTA',
      'Un proveedor se unió desde la red',
      `${p.nombre} se unió a "${r.titulo}" como proveedor homologado de la red.`,
      `/cliente/licitaciones/${r.id}`,
    );
    return { ok: true, requerimientoId: r.id };
  }

  // --------------------------------------------------------------- público

  /** Public directory of homologated suppliers (the network, no login). */
  async directorio(opts: { q?: string; categoria?: string; page?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const q = opts.q?.trim();
    const where: Prisma.ProveedorProfileWhereInput = {
      homologacion: { estado: EstadoHomologacion.APROBADO },
      ...(opts.categoria ? { categorias: { has: opts.categoria } } : {}),
      ...(q
        ? {
            OR: [
              { nombre: { contains: q, mode: 'insensitive' } },
              { descripcion: { contains: q, mode: 'insensitive' } },
              { ubicacion: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items, todas] = await Promise.all([
      this.prisma.proveedorProfile.count({ where }),
      this.prisma.proveedorProfile.findMany({
        where,
        orderBy: [{ score: 'desc' }, { nombre: 'asc' }],
        skip: (page - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: {
          id: true,
          nombre: true,
          iniciales: true,
          color: true,
          categorias: true,
          ubicacion: true,
          descripcion: true,
          score: true,
          desempenoPromedio: true,
          evaluacionesCount: true,
          procesosGanados: true,
        },
      }),
      this.prisma.proveedorProfile.findMany({
        where: { homologacion: { estado: EstadoHomologacion.APROBADO } },
        select: { categorias: true },
      }),
    ]);
    const conteo = new Map<string, number>();
    for (const t of todas)
      for (const c of t.categorias) conteo.set(c, (conteo.get(c) ?? 0) + 1);
    return {
      items: items.map((p) => ({
        ...p,
        descripcion: p.descripcion?.slice(0, 200) ?? null,
      })),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / POR_PAGINA)),
      categorias: [...conteo.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
        .map(([nombre, proveedores]) => ({ nombre, proveedores })),
    };
  }

  /** Headline numbers for the public pages. */
  async estadisticas() {
    const [proveedores, empresas, abiertos] = await Promise.all([
      this.prisma.proveedorProfile.count({
        where: { homologacion: { estado: EstadoHomologacion.APROBADO } },
      }),
      this.prisma.company.count(),
      this.prisma.requerimiento.count({
        where: {
          abiertoRed: true,
          estado: EstadoRequerimiento.EN_LICITACION,
          fechaLimite: { gt: new Date() },
        },
      }),
    ]);
    return {
      proveedoresHomologados: proveedores,
      empresas,
      convocatoriasAbiertas: abiertos,
    };
  }
}
