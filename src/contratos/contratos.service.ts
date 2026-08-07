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
      include: { hitos: true },
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
}
