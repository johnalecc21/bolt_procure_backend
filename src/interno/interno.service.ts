import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Injectable()
export class InternoService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  // --- Casos consultor ---------------------------------------------------

  listCasos(consultorId?: string) {
    return this.prisma.casoConsultor.findMany({
      where: consultorId ? { consultorId } : undefined,
      include: { company: true },
      orderBy: [{ prioridad: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // --- Admin clientes ------------------------------------------------------

  listClientes() {
    return this.prisma.company.findMany({
      include: { _count: { select: { requerimientos: true } } },
    });
  }

  async impersonar(companyId: string, actorId: string, actorNombre: string, motivo: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Cliente no encontrado.');
    await this.auditLog.log({
      usuarioId: actorId,
      usuario: actorNombre,
      accion: 'Impersonación de cliente',
      detalle: `Entró como ${company.nombre} para dar soporte`,
      motivo,
    });
    return { ok: true, empresa: company.nombre };
  }

  // --- Benchmark de mercado --------------------------------------------

  listBenchmark() {
    return this.prisma.benchmarkEntry.findMany();
  }

  async marcarValido(id: string) {
    return this.prisma.benchmarkEntry.update({ where: { id }, data: { outlier: false } });
  }
}
