import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EstadoContrato,
  EstadoRequerimiento,
  Portal,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupabaseService } from '../supabase/supabase.service';
import { iniciales } from '../common/utils/iniciales.util';
import { CrearClienteDto } from './dto/crear-cliente.dto';
import { urlFrontend } from '../config/origenes';
import { PlanesService } from '../planes/planes.service';

/** Requerimientos that are neither drafts nor finished. */
const EN_CURSO: EstadoRequerimiento[] = [
  EstadoRequerimiento.PENDIENTE_APROBACION,
  EstadoRequerimiento.EN_LICITACION,
  EstadoRequerimiento.EN_NEGOCIACION,
  EstadoRequerimiento.ADJUDICADO,
  EstadoRequerimiento.EN_CUMPLIMIENTO,
];

const CONTRATO_VIGENTE: EstadoContrato[] = [
  EstadoContrato.ACTIVO,
  EstadoContrato.POR_VENCER,
];

@Injectable()
export class InternoService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private supabase: SupabaseService,
    private config: ConfigService,
    private planes: PlanesService,
  ) {}

  // Procurex's internal team follows each client company as an account: how
  // far it got setting up, how much it uses the platform and how its spend
  // is going. It never sees or acts on the content of a purchase process
  // (titles, offers, prices, suppliers chosen) — that belongs to the company.

  async listClientes() {
    const companies = await this.prisma.company.findMany({
      select: {
        id: true,
        nombre: true,
        plan: true,
        facturacion: true,
        createdAt: true,
        memberships: {
          where: { activo: true, user: { activo: true } },
          select: {
            user: {
              select: {
                nombre: true,
                email: true,
                role: true,
                lastLoginAt: true,
              },
            },
          },
        },
        _count: { select: { matrizReglas: true } },
      },
      orderBy: { createdAt: 'desc' },
      // Growth guard-rail, not page size.
      take: 500,
    });
    const ids = companies.map((c) => c.id);
    const [enCurso, total, contratos] = await Promise.all([
      this.prisma.requerimiento.groupBy({
        by: ['companyId'],
        where: { companyId: { in: ids }, estado: { in: EN_CURSO } },
        _count: { _all: true },
      }),
      this.prisma.requerimiento.groupBy({
        by: ['companyId'],
        where: { companyId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.contrato.groupBy({
        by: ['companyId'],
        where: { companyId: { in: ids }, estado: { in: CONTRATO_VIGENTE } },
        _count: { _all: true },
      }),
    ]);
    const cuenta = (rows: { companyId: string; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.companyId, r._count._all]));
    const enCursoPor = cuenta(enCurso);
    const totalPor = cuenta(total);
    const contratosPor = cuenta(contratos);

    return companies.map((c) => {
      const usuarios = c.memberships.map((m) => m.user);
      const admin = usuarios.find((u) => u.role === Role.ADMIN_CLIENTE);
      const ultimoAcceso = usuarios
        .map((u) => u.lastLoginAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const requerimientos = totalPor.get(c.id) ?? 0;
      const pasos = [
        usuarios.length > 1,
        c._count.matrizReglas > 0,
        requerimientos > 0,
      ];
      return {
        id: c.id,
        nombre: c.nombre,
        plan: c.plan,
        facturacion: c.facturacion,
        creada: c.createdAt,
        contactoPrincipal: admin?.nombre ?? '—',
        correoContacto: admin?.email ?? null,
        usuariosActivos: usuarios.length,
        procesosEnCurso: enCursoPor.get(c.id) ?? 0,
        procesosTotales: requerimientos,
        contratosVigentes: contratosPor.get(c.id) ?? 0,
        ultimoAcceso: ultimoAcceso ?? null,
        configuracion: {
          hechos: pasos.filter(Boolean).length,
          total: pasos.length,
        },
      };
    });
  }

  /** One company as an account: setup, plan usage, team and aggregate activity. */
  async resumenCliente(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        nombre: true,
        plan: true,
        facturacion: true,
        pais: true,
        monedaBase: true,
        createdAt: true,
        exigeCentroCosto: true,
        categoriasHomologacionRequeridas: true,
        integracionErp: { select: { activa: true, modo: true, sistema: true } },
        marcaDocumentos: { select: { id: true } },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada.');

    const hoy = new Date();
    const hace6Meses = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 5, 1),
    );
    const hace12Meses = new Date(
      Date.UTC(hoy.getUTCFullYear() - 1, hoy.getUTCMonth(), hoy.getUTCDate()),
    );

    const [
      uso,
      miembros,
      reglas,
      centros,
      plantillas,
      porEstado,
      creados,
      contratosPorEstado,
      contratos12m,
      pagosPorEstado,
      ultimaActividad,
    ] = await Promise.all([
      this.planes.uso(companyId),
      this.prisma.companyMembership.findMany({
        where: { companyId },
        select: {
          activo: true,
          user: {
            select: {
              nombre: true,
              email: true,
              role: true,
              activo: true,
              lastLoginAt: true,
            },
          },
        },
      }),
      this.prisma.matrizAprobacionRegla.count({ where: { companyId } }),
      this.prisma.centroCosto.count({ where: { companyId, activo: true } }),
      this.prisma.plantillaDocumento.count({
        where: { companyId, activa: true },
      }),
      this.prisma.requerimiento.groupBy({
        by: ['estado'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.requerimiento.findMany({
        where: { companyId, createdAt: { gte: hace6Meses } },
        select: { createdAt: true },
      }),
      this.prisma.contrato.groupBy({
        by: ['estado'],
        where: { companyId },
        _count: { _all: true },
      }),
      // POs issued under a Contrato Marco are left out so spend isn't counted twice.
      this.prisma.contrato.findMany({
        where: {
          companyId,
          contratoPadreId: null,
          createdAt: { gte: hace12Meses },
        },
        select: {
          monto: true,
          moneda: true,
          proveedorId: true,
          createdAt: true,
        },
      }),
      this.prisma.pagoPO.groupBy({
        by: ['estado'],
        where: { contrato: { companyId } },
        _count: { _all: true },
      }),
      this.prisma.auditLogEntry.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const usuarios = miembros.map((m) => ({
      nombre: m.user.nombre,
      email: m.user.email,
      rol: m.user.role,
      activo: m.activo && m.user.activo,
      ultimoAcceso: m.user.lastLoginAt,
    }));
    const activos = usuarios.filter((u) => u.activo);
    const totalRequerimientos = porEstado.reduce(
      (s, r) => s + r._count._all,
      0,
    );

    const meses: { mes: string; procesos: number; contratos: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(
        Date.UTC(hace6Meses.getUTCFullYear(), hace6Meses.getUTCMonth() + i, 1),
      );
      meses.push({
        mes: d.toISOString().slice(0, 7),
        procesos: 0,
        contratos: 0,
      });
    }
    const idxMes = (d: Date) =>
      meses.findIndex((m) => m.mes === d.toISOString().slice(0, 7));
    for (const r of creados) {
      const i = idxMes(r.createdAt);
      if (i >= 0) meses[i].procesos++;
    }
    for (const c of contratos12m) {
      const i = idxMes(c.createdAt);
      if (i >= 0) meses[i].contratos++;
    }
    const enBase = contratos12m.filter((c) => c.moneda === company.monedaBase);

    return {
      empresa: {
        id: company.id,
        nombre: company.nombre,
        plan: company.plan,
        facturacion: company.facturacion,
        pais: company.pais,
        monedaBase: company.monedaBase,
        creada: company.createdAt,
      },
      uso,
      configuracion: [
        {
          clave: 'equipo',
          label: 'Equipo invitado',
          hecho: activos.length > 1,
          opcional: false,
        },
        {
          clave: 'matriz',
          label: 'Matriz de aprobación',
          hecho: reglas > 0,
          opcional: false,
        },
        {
          clave: 'requerimiento',
          label: 'Primer requerimiento',
          hecho: totalRequerimientos > 0,
          opcional: false,
        },
        {
          clave: 'centros',
          label: 'Centros de costo y presupuestos',
          hecho: centros > 0,
          opcional: true,
        },
        {
          clave: 'homologacion',
          label: 'Requisitos de homologación',
          hecho: company.categoriasHomologacionRequeridas.length > 0,
          opcional: true,
        },
        {
          clave: 'plantillas',
          label: 'Plantillas o marca de documentos',
          hecho: plantillas > 0 || !!company.marcaDocumentos,
          opcional: true,
        },
        {
          clave: 'erp',
          label: 'Integración con ERP',
          hecho: !!company.integracionErp?.activa,
          opcional: true,
          detalle: company.integracionErp?.activa
            ? (company.integracionErp.sistema ?? company.integracionErp.modo)
            : null,
        },
      ],
      usuarios: usuarios.sort(
        (a, b) =>
          Number(b.activo) - Number(a.activo) ||
          a.nombre.localeCompare(b.nombre),
      ),
      actividad: {
        ultimaActividad: ultimaActividad?.createdAt ?? null,
        procesosPorEstado: Object.fromEntries(
          porEstado.map((r) => [r.estado, r._count._all]),
        ),
        procesosTotales: totalRequerimientos,
        contratosPorEstado: Object.fromEntries(
          contratosPorEstado.map((r) => [r.estado, r._count._all]),
        ),
        pagosPorEstado: Object.fromEntries(
          pagosPorEstado.map((r) => [r.estado, r._count._all]),
        ),
        ultimos12Meses: {
          contratos: contratos12m.length,
          montoContratado: enBase.reduce((s, c) => s + c.monto, 0),
          contratosEnOtraMoneda: contratos12m.length - enBase.length,
          proveedoresContratados: new Set(
            contratos12m.map((c) => c.proveedorId).filter(Boolean),
          ).size,
        },
        porMes: meses,
      },
    };
  }

  // Ops-assisted onboarding: creates the Company + its first admin_cliente
  // user and invites them by email (Supabase sends the real invite, whose
  // link lands on /set-password so they choose their own password).
  async crearCliente(
    dto: CrearClienteDto,
    actorId: string,
    actorNombre: string,
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con este correo.');
    }

    const frontendUrl = urlFrontend(
      this.config.get<string>('APP_URL'),
      this.config.get<string>('CORS_ORIGIN'),
    );
    const { data, error } =
      await this.supabase.admin.auth.admin.inviteUserByEmail(
        dto.adminEmail.toLowerCase(),
        {
          redirectTo: `${frontendUrl}/set-password`,
        },
      );
    if (error || !data.user) {
      throw new ConflictException(
        error?.message ?? 'No se pudo invitar a esa cuenta.',
      );
    }

    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { nombre: dto.nombreEmpresa.trim() },
        });
        const user = await tx.user.create({
          data: {
            id: data.user.id,
            nombre: dto.adminNombre.trim(),
            email: dto.adminEmail.toLowerCase(),
            portal: Portal.CLIENTE,
            role: Role.ADMIN_CLIENTE,
            iniciales: iniciales(dto.adminNombre),
            cargo: 'Administrador',
          },
        });
        await tx.companyMembership.create({
          data: { userId: user.id, companyId: company.id },
        });
        return company;
      });
      await this.auditLog.log({
        companyId: company.id,
        usuarioId: actorId,
        usuario: actorNombre,
        accion: 'Empresa cliente creada',
        detalle: `${company.nombre} — admin invitado: ${dto.adminEmail}`,
      });
      return { id: company.id, nombre: company.nombre };
    } catch (err) {
      // Roll back the Supabase invite if the Prisma setup failed.
      await this.supabase.admin.auth.admin
        .deleteUser(data.user.id)
        .catch(() => undefined);
      throw err;
    }
  }
}
