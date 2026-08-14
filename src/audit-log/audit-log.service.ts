import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/pagination.dto';

export interface LogAuditInput {
  // Omit only for actions with no company involved at all (e.g. Interno
  // resolving a proveedor's homologación) — those rows are then visible
  // only from the unscoped Interno view, never to any cliente company.
  companyId?: string;
  usuarioId?: string;
  usuario: string;
  accion: string;
  detalle: string;
  motivo?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  log(input: LogAuditInput) {
    return this.prisma.auditLogEntry.create({ data: input });
  }

  /** `companyId: null` means unscoped — only Interno callers may pass that. */
  async list(companyId: string | null, page: number, limit: number) {
    const where = companyId ? { companyId } : undefined;
    const [items, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }
}
