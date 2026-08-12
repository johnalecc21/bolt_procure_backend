import { Injectable } from '@nestjs/common';
import { TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificacionesService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.notificacion.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(userId: string, tipo: TipoNotificacion, titulo: string, desc: string, link?: string) {
    return this.prisma.notificacion.create({ data: { userId, tipo, titulo, desc, link } });
  }

  async markAsRead(userId: string, id: string) {
    await this.prisma.notificacion.updateMany({ where: { id, userId }, data: { leida: true } });
    return { ok: true };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notificacion.updateMany({ where: { userId, leida: false }, data: { leida: true } });
    return { ok: true };
  }
}
