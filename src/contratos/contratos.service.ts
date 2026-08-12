import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ContratosService {
  constructor(private prisma: PrismaService) {}

  list(companyId: string, params?: { categoria?: string; query?: string }) {
    return this.prisma.contrato.findMany({
      where: {
        companyId,
        ...(params?.categoria && params.categoria !== 'Todas' ? { categoria: params.categoria } : {}),
        ...(params?.query
          ? {
              OR: [
                { id: { contains: params.query, mode: 'insensitive' } },
                { proveedorNombre: { contains: params.query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } } },
    });
  }

  async findOne(companyId: string, id: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, companyId },
      include: { hitos: { orderBy: { orden: 'asc' } } },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    return this.prisma.contrato.findMany({
      where: { requerimiento: { adjudicacion: { proveedorId } } },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } }, company: true },
    });
  }

  async findOneMine(userId: string, id: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const contrato = await this.prisma.contrato.findFirst({
      where: { id, requerimiento: { adjudicacion: { proveedorId } } },
      include: { hitos: { orderBy: { orden: 'asc' } }, company: true },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return contrato;
  }
}
