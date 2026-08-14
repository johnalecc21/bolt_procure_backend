import { Injectable } from '@nestjs/common';
import { TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIST_LIMIT = 50;

@Injectable()
export class NotificacionesService {
  constructor(private prisma: PrismaService) {}

  // Bounded to the most recent N — this is a bell-dropdown feed, not a
  // browsable archive, so it doesn't need page controls. unreadCount is
  // computed separately (not `items.filter`) so the badge stays correct
  // even for a user with more unread notifications than the list shows.
  async list(userId: string, limit = DEFAULT_LIST_LIMIT) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notificacion.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notificacion.count({ where: { userId, leida: false } }),
    ]);
    return { items, unreadCount };
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
