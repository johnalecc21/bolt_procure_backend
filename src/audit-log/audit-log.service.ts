import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LogAuditInput {
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

  list(limit?: number) {
    return this.prisma.auditLogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
