import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHito } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SeguimientoService {
  constructor(private prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.contrato.findMany({
      where: { companyId, hitos: { some: {} } },
      include: { hitos: { orderBy: { orden: 'asc' } } },
    });
  }

  async confirmarRecepcion(companyId: string, hitoId: string) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    return this.prisma.hitoSeguimiento.update({
      where: { id: hitoId },
      data: { estado: EstadoHito.COMPLETADO, real: new Date() },
    });
  }
}
