import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TASA_DESCUENTO_MENSUAL = 0.015;

@Injectable()
export class PagosService {
  constructor(private prisma: PrismaService) {}

  private async proveedorIdForUser(userId: string) {
    const profile = await this.prisma.proveedorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No tienes un perfil de proveedor asociado.');
    return profile.id;
  }

  async listMine(userId: string) {
    const proveedorId = await this.proveedorIdForUser(userId);
    return this.prisma.pagoPO.findMany({
      where: { proveedorId },
      include: { contrato: true },
      orderBy: { fechaPagoPactada: 'asc' },
    });
  }

  async simularProntoPago(userId: string, pagoId: string, diasAdelanto: number) {
    const proveedorId = await this.proveedorIdForUser(userId);
    const pago = await this.prisma.pagoPO.findFirst({ where: { id: pagoId, proveedorId } });
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    if (pago.disputaAbierta) {
      throw new BadRequestException('No disponible: la PO tiene una disputa abierta.');
    }
    const montoAdelanto = Math.round(pago.monto * (1 - (TASA_DESCUENTO_MENSUAL * diasAdelanto) / 30));
    return { montoOriginal: pago.monto, montoAdelanto, descuento: pago.monto - montoAdelanto };
  }
}
