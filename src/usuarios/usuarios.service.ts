import { BadRequestException, Injectable } from '@nestjs/common';
import { Role, Portal } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InviteUserDto } from './dto/invite-user.dto';

@Injectable()
export class UsuariosService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async listByCompany(companyId: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { companyId },
      include: { user: true },
    });
    return memberships.map((m) => ({
      id: m.user.id,
      nombre: m.user.nombre,
      email: m.user.email,
      rol: m.user.role,
      activo: m.activo && m.user.activo,
      ultimoAcceso: m.user.lastLoginAt,
    }));
  }

  private async activeAdminCount(companyId: string) {
    return this.prisma.companyMembership.count({
      where: { companyId, activo: true, user: { role: Role.ADMIN_CLIENTE, activo: true } },
    });
  }

  async invite(companyId: string, dto: InviteUserDto, actorNombre: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const iniciales = dto.email.split('@')[0].slice(0, 2).toUpperCase();
    const passwordHash = await bcrypt.hash('demo123', 10);

    const user =
      existing ??
      (await this.prisma.user.create({
        data: {
          nombre: dto.email.split('@')[0],
          email: dto.email.toLowerCase(),
          passwordHash,
          portal: Portal.CLIENTE,
          role: dto.role,
          iniciales,
        },
      }));

    await this.prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      create: { userId: user.id, companyId },
      update: { activo: true },
    });

    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Usuario invitado',
      detalle: `${dto.email} → ${dto.role}`,
    });

    return { id: user.id, email: user.email };
  }

  async updateRole(companyId: string, userId: string, role: Role, actorNombre: string) {
    const membership = await this.prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId, companyId } },
      include: { user: true },
    });

    if (membership.user.role === Role.ADMIN_CLIENTE && role !== Role.ADMIN_CLIENTE) {
      const admins = await this.activeAdminCount(companyId);
      if (admins <= 1) {
        throw new BadRequestException('No puedes quitar el rol Admin al último administrador activo.');
      }
    }

    const rolAnterior = membership.user.role;
    await this.prisma.user.update({ where: { id: userId }, data: { role } });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: 'Cambio de rol',
      detalle: `${membership.user.nombre}: ${rolAnterior} → ${role}`,
    });
    return { ok: true };
  }

  async toggleActive(companyId: string, userId: string, actorNombre: string) {
    const membership = await this.prisma.companyMembership.findUniqueOrThrow({
      where: { userId_companyId: { userId, companyId } },
      include: { user: true },
    });

    if (membership.user.role === Role.ADMIN_CLIENTE && membership.activo) {
      const admins = await this.activeAdminCount(companyId);
      if (admins <= 1) {
        throw new BadRequestException('No puedes desactivar al último administrador activo.');
      }
    }

    const nextActive = !membership.activo;
    await this.prisma.companyMembership.update({
      where: { userId_companyId: { userId, companyId } },
      data: { activo: nextActive },
    });
    await this.auditLog.log({
      usuario: actorNombre,
      accion: nextActive ? 'Usuario reactivado' : 'Usuario desactivado',
      detalle: membership.user.email,
    });
    return { ok: true };
  }
}
