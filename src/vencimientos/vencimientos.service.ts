import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EstadoContrato, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { formatContratoCodigo } from '../common/utils/codigo.util';

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const UMBRALES = [60, 30, 15] as const;

@Injectable()
export class VencimientosService {
  private readonly logger = new Logger(VencimientosService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private notificaciones: NotificacionesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async procesarVencimientos() {
    const contratos = await this.prisma.contrato.findMany({
      where: { estado: { in: [EstadoContrato.ACTIVO, EstadoContrato.POR_VENCER] } },
    });

    const ahora = Date.now();
    let vencidos = 0;
    let porVencerNuevos = 0;
    let recordatoriosEnviados = 0;

    for (const contrato of contratos) {
      const diasRestantes = Math.ceil((contrato.vigenciaFin.getTime() - ahora) / MS_POR_DIA);

      if (diasRestantes < 0) {
        const codigo = formatContratoCodigo(contrato.tipo, contrato.numero);
        await this.prisma.contrato.update({ where: { id: contrato.id }, data: { estado: EstadoContrato.VENCIDO } });
        await this.auditLog.log({
          companyId: contrato.companyId,
          usuario: 'Sistema (cron vencimientos)',
          accion: 'Contrato vencido',
          detalle: `${codigo} venció el ${contrato.vigenciaFin.toISOString().slice(0, 10)}`,
        });
        await this.notificarResponsables(
          contrato.companyId,
          'CONTRATO',
          'Contrato vencido',
          `${codigo} (${contrato.proveedorNombre}) venció y sigue en estado activo. Revisa si requiere renovación.`,
          '/cliente/contratos',
        );
        vencidos++;
        continue;
      }

      if (diasRestantes <= 30 && contrato.estado === EstadoContrato.ACTIVO) {
        await this.prisma.contrato.update({ where: { id: contrato.id }, data: { estado: EstadoContrato.POR_VENCER } });
        porVencerNuevos++;
      }

      for (const umbral of UMBRALES) {
        const campo = `recordatorio${umbral}Enviado` as 'recordatorio60Enviado' | 'recordatorio30Enviado' | 'recordatorio15Enviado';
        if (diasRestantes <= umbral && !contrato[campo]) {
          await this.prisma.contrato.update({ where: { id: contrato.id }, data: { [campo]: true } });
          await this.notificarResponsables(
            contrato.companyId,
            'CONTRATO',
            `Vence en ${diasRestantes} días`,
            `${formatContratoCodigo(contrato.tipo, contrato.numero)} (${contrato.proveedorNombre}) vence el ${contrato.vigenciaFin.toISOString().slice(0, 10)} — quedan ${diasRestantes} días.`,
            '/cliente/contratos',
          );
          recordatoriosEnviados++;
        }
      }
    }

    this.logger.log(
      `Vencimientos procesados: ${contratos.length} contratos revisados, ${vencidos} marcados VENCIDO, ${porVencerNuevos} nuevos POR_VENCER, ${recordatoriosEnviados} recordatorios enviados.`,
    );
    return { revisados: contratos.length, vencidos, porVencerNuevos, recordatoriosEnviados };
  }

  private async notificarResponsables(companyId: string, tipo: 'CONTRATO', titulo: string, desc: string, link: string) {
    const memberships = await this.prisma.companyMembership.findMany({
      where: { companyId, activo: true, user: { role: { in: [Role.COMPRADOR, Role.ADMIN_CLIENTE] }, activo: true } },
      include: { user: true },
    });
    await Promise.all(memberships.map((m) => this.notificaciones.create(m.user.id, tipo, titulo, desc, link)));
  }
}
