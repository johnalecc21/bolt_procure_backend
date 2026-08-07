import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertOfertaDto } from './dto/upsert-oferta.dto';

@Injectable()
export class OfertasService {
  constructor(private prisma: PrismaService) {}

  listByRequerimiento(requerimientoId: string) {
    return this.prisma.oferta.findMany({
      where: { requerimientoId },
      include: { proveedor: true },
    });
  }

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async upsert(userId: string, dto: UpsertOfertaDto) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const existing = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId: dto.requerimientoId, proveedorId } },
    });
    if (existing?.enviada) {
      throw new BadRequestException('Esta oferta ya fue enviada y no es editable.');
    }
    return this.prisma.oferta.upsert({
      where: { requerimientoId_proveedorId: { requerimientoId: dto.requerimientoId, proveedorId } },
      create: { ...dto, proveedorId },
      update: { ...dto },
    });
  }

  async enviar(userId: string, requerimientoId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const oferta = await this.prisma.oferta.findUnique({
      where: { requerimientoId_proveedorId: { requerimientoId, proveedorId } },
    });
    if (!oferta) throw new NotFoundException('Aún no has completado tu oferta.');
    await this.prisma.$transaction([
      this.prisma.oferta.update({ where: { id: oferta.id }, data: { enviada: true } }),
      this.prisma.requerimiento.update({
        where: { id: requerimientoId },
        data: { ofertasRecibidas: { increment: 1 } },
      }),
    ]);
    return { ok: true };
  }
}
