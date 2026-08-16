import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProveedoresService } from '../proveedores/proveedores.service';

const TASA_DESCUENTO_MENSUAL = 0.015;

@Injectable()
export class PagosService {
  constructor(
    private prisma: PrismaService,
    private proveedores: ProveedoresService,
  ) {}

  async listMine(userId: string) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    return this.prisma.pagoPO.findMany({
      where: { proveedorId },
      include: { contrato: { include: { company: true } } },
      orderBy: { fechaPagoPactada: 'asc' },
      take: 200,
    });
  }

  async simularProntoPago(userId: string, pagoId: string, diasAdelanto: number) {
    const proveedorId = await this.proveedores.findIdForUser(userId);
    const pago = await this.prisma.pagoPO.findFirst({ where: { id: pagoId, proveedorId } });
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    if (pago.disputaAbierta) {
      throw new BadRequestException('No disponible: la PO tiene una disputa abierta.');
    }
    const montoAdelanto = Math.round(pago.monto * (1 - (TASA_DESCUENTO_MENSUAL * diasAdelanto) / 30));
    return { montoOriginal: pago.monto, montoAdelanto, descuento: pago.monto - montoAdelanto };
  }
}
