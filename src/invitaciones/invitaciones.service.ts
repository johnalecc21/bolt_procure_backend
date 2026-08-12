import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoInvitacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvitacionesService {
  constructor(private prisma: PrismaService) {}

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    return this.prisma.invitacion.findMany({
      where: { proveedorId, enviada: true },
      include: { company: true, requerimiento: { select: { titulo: true } } },
      orderBy: { fechaLimite: 'asc' },
    });
  }

  async responder(userId: string, id: string, estado: 'VISTA' | 'DECLINADA') {
    const proveedorId = await this.proveedorIdForUser(userId);
    const invitacion = await this.prisma.invitacion.findFirst({ where: { id, proveedorId } });
    if (!invitacion) throw new NotFoundException('Invitación no encontrada.');
    return this.prisma.invitacion.update({
      where: { id },
      data: { estado: estado as EstadoInvitacion },
    });
  }

  async crear(companyId: string, proveedorId: string, requerimientoId: string, categoria: string, fechaLimite: Date) {
    return this.prisma.invitacion.create({
      data: { companyId, proveedorId, requerimientoId, categoria, fechaLimite },
    });
  }
}
