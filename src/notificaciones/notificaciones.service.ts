import { Injectable } from '@nestjs/common';
import { TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const ACCION_POR_TIPO: Record<TipoNotificacion, string> = {
  APROBACION: 'Revisar aprobación',
  OFERTA: 'Ver oferta',
  CONTRATO: 'Ver contrato',
  NEGOCIACION: 'Ir a la negociación',
  PROVEEDOR: 'Abrir Procurex',
};

const DEFAULT_LIST_LIMIT = 50;

@Injectable()
export class NotificacionesService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

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

  /**
   * Every in-app notification is also emailed (unless the user opted out),
   * so people act on invitations and approvals without having the app open.
   */
  async create(userId: string, tipo: TipoNotificacion, titulo: string, desc: string, link?: string) {
    const notificacion = await this.prisma.notificacion.create({ data: { userId, tipo, titulo, desc, link } });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, activo: true, recibirCorreos: true, portal: true },
    });
    if (user?.activo && user.recibirCorreos) {
      this.email.enviar(user.email, titulo, {
        titulo,
        cuerpo: desc,
        accionUrl: link ? this.email.url(link) : undefined,
        accionTexto: ACCION_POR_TIPO[tipo],
        preferenciasUrl: this.email.url(`/${user.portal.toLowerCase()}/configuracion`),
      });
    }
    return notificacion;
  }

  async preferencias(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recibirCorreos: true } });
    return { recibirCorreos: user.recibirCorreos, correoHabilitado: this.email.habilitado };
  }

  async fijarPreferencias(userId: string, recibirCorreos: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { recibirCorreos } });
    return this.preferencias(userId);
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
