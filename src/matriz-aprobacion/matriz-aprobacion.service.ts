import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ReglaDto } from './dto/upsert-reglas.dto';
import { formatMonto } from '../common/utils/moneda.util';
import type { UpdateConfigDto } from './dto/update-config.dto';

@Injectable()
export class MatrizAprobacionService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  list(companyId: string) {
    return this.prisma.matrizAprobacionRegla.findMany({
      where: { companyId },
      orderBy: { montoMin: 'asc' },
    });
  }

  private validate(reglas: ReglaDto[]) {
    if (reglas.length === 0) throw new BadRequestException('Debe existir al menos una regla.');
    const sorted = [...reglas].sort((a, b) => a.montoMin - b.montoMin);
    if (sorted[0].montoMin !== 0) {
      throw new BadRequestException("El primer rango debe empezar en $0.");
    }
    if (sorted[sorted.length - 1].montoMax != null) {
      throw new BadRequestException("Debe existir una regla sin máximo que cubra cualquier monto.");
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (cur.montoMax == null) {
        throw new BadRequestException(`La regla que empieza en ${cur.montoMin} no puede tener máximo abierto si no es la última.`);
      }
      if (cur.montoMax + 1 < next.montoMin) {
        throw new BadRequestException(`Hay un hueco entre ${cur.montoMax} y ${next.montoMin}.`);
      }
      if (cur.montoMax >= next.montoMin) {
        throw new BadRequestException(`Los rangos que empiezan en ${cur.montoMin} y ${next.montoMin} se solapan.`);
      }
    }
  }

  async replace(companyId: string, reglas: ReglaDto[], actorNombre: string) {
    this.validate(reglas);
    await this.prisma.$transaction([
      this.prisma.matrizAprobacionRegla.deleteMany({ where: { companyId } }),
      this.prisma.matrizAprobacionRegla.createMany({
        data: reglas.map((r) => ({ ...r, companyId })),
      }),
    ]);
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Matriz de aprobación actualizada',
      detalle: `${reglas.length} reglas configuradas`,
    });
    return this.list(companyId);
  }

  async getConfig(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { umbralContratoMarco: true, monedaBase: true, pais: true },
    });
  }

  async updateConfig(companyId: string, dto: UpdateConfigDto, actorNombre: string) {
    const { umbralContratoMarco } = dto;
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        umbralContratoMarco,
        ...(dto.monedaBase ? { monedaBase: dto.monedaBase } : {}),
        ...(dto.pais ? { pais: dto.pais.toUpperCase() } : {}),
      },
    });
    await this.auditLog.log({
      companyId,
      usuario: actorNombre,
      accion: 'Umbral de Contrato Marco actualizado',
      detalle: `Nuevo umbral: ${formatMonto(umbralContratoMarco, company.monedaBase)} · país ${company.pais}`,
    });
    return this.getConfig(companyId);
  }
}
