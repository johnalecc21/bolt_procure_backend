import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoHito } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHitoDto } from './dto/create-hito.dto';
import { UpdateHitoDto } from './dto/update-hito.dto';

@Injectable()
export class SeguimientoService {
  constructor(private prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.contrato.findMany({
      where: { companyId },
      orderBy: { vigenciaFin: 'asc' },
      include: { hitos: { orderBy: { orden: 'asc' } } },
    });
  }

  async crearHito(companyId: string, contratoId: string, dto: CreateHitoDto) {
    const contrato = await this.prisma.contrato.findFirst({
      where: { id: contratoId, companyId },
      include: { _count: { select: { hitos: true } } },
    });
    if (!contrato) throw new NotFoundException('Contrato no encontrado.');
    return this.prisma.hitoSeguimiento.create({
      data: {
        contratoId,
        label: dto.label,
        comprometido: new Date(dto.comprometido),
        orden: contrato._count.hitos,
      },
    });
  }

  async actualizarHito(companyId: string, hitoId: string, dto: UpdateHitoDto) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    return this.prisma.hitoSeguimiento.update({
      where: { id: hitoId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.comprometido !== undefined ? { comprometido: new Date(dto.comprometido) } : {}),
        ...(dto.estado !== undefined
          ? { estado: dto.estado, real: dto.estado === EstadoHito.COMPLETADO ? (hito.real ?? new Date()) : hito.real }
          : {}),
      },
    });
  }

  async eliminarHito(companyId: string, hitoId: string) {
    const hito = await this.prisma.hitoSeguimiento.findFirst({
      where: { id: hitoId, contrato: { companyId } },
    });
    if (!hito) throw new NotFoundException('Hito no encontrado.');
    await this.prisma.hitoSeguimiento.delete({ where: { id: hitoId } });
    return { ok: true };
  }
}
