import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Portal, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SupabaseService } from '../supabase/supabase.service';
import { iniciales } from '../common/utils/iniciales.util';
import { CrearClienteDto } from './dto/crear-cliente.dto';

@Injectable()
export class InternoService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {}

  // --- Casos consultor ---------------------------------------------------

  listCasos(consultorId?: string) {
    return this.prisma.casoConsultor.findMany({
      where: consultorId ? { consultorId } : undefined,
      include: { company: true },
      orderBy: [{ prioridad: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // --- Admin clientes ------------------------------------------------------

  async listClientes() {
    const companies = await this.prisma.company.findMany({
      include: {
        _count: { select: { requerimientos: true } },
        memberships: {
          where: { user: { role: 'ADMIN_CLIENTE' } },
          include: { user: true },
          take: 1,
        },
      },
    });
    return companies.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      plan: c.plan,
      facturacion: c.facturacion,
      procesosActivos: c._count.requerimientos,
      contactoPrincipal: c.memberships[0]?.user.nombre ?? '—',
    }));
  }

  // Ops-assisted onboarding: creates the Company + its first admin_cliente
  // user and invites them by email (Supabase sends the real invite, whose
  // link lands on /set-password so they choose their own password).
  async crearCliente(dto: CrearClienteDto, actorId: string, actorNombre: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail.toLowerCase() } });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con este correo.');
    }

    const frontendUrl = this.config.get('CORS_ORIGIN', 'http://localhost:5173');
    const { data, error } = await this.supabase.admin.auth.admin.inviteUserByEmail(dto.adminEmail.toLowerCase(), {
      redirectTo: `${frontendUrl}/set-password`,
    });
    if (error || !data.user) {
      throw new ConflictException(error?.message ?? 'No se pudo invitar a esa cuenta.');
    }

    try {
      const company = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({ data: { nombre: dto.nombreEmpresa.trim() } });
        const user = await tx.user.create({
          data: {
            id: data.user!.id,
            nombre: dto.adminNombre.trim(),
            email: dto.adminEmail.toLowerCase(),
            portal: Portal.CLIENTE,
            role: Role.ADMIN_CLIENTE,
            iniciales: iniciales(dto.adminNombre),
            cargo: 'Administrador',
          },
        });
        await tx.companyMembership.create({ data: { userId: user.id, companyId: company.id } });
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
      await this.supabase.admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw err;
    }
  }

  async impersonar(companyId: string, actorId: string, actorNombre: string, motivo: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Cliente no encontrado.');
    await this.auditLog.log({
      companyId,
      usuarioId: actorId,
      usuario: actorNombre,
      accion: 'Impersonación de cliente',
      detalle: `Entró como ${company.nombre} para dar soporte`,
      motivo,
    });
    return { ok: true, empresa: company.nombre };
  }

  // --- Benchmark de mercado --------------------------------------------

  listBenchmark() {
    return this.prisma.benchmarkEntry.findMany();
  }

  async marcarValido(id: string) {
    return this.prisma.benchmarkEntry.update({ where: { id }, data: { outlier: false } });
  }
}
