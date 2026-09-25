import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuditLogService } from './audit-log.service';
import { ExportarAuditoriaDto, RetencionDto } from './dto/audit.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private service: AuditLogService) {}

  // A company's own trail, shown in Contratos and Configuración.
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() { page = 1, limit = 20 }: PaginationQueryDto,
  ) {
    // Each company's trail is its own: Procurex's internal team follows
    // companies through /interno/clientes (aggregates), never their log.
    if (user.portal !== 'CLIENTE') {
      throw new ForbiddenException(
        'Este recurso no está disponible en este portal.',
      );
    }
    return this.service.list(user.companyId, page, limit);
  }

  /** CSV download of the company's own trail (Admin / CFO). */
  @Get('export')
  @PortalOnly('CLIENTE')
  @Roles(Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  async exportar(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ExportarAuditoriaDto,
    @Res() res: Response,
  ) {
    const companyId = user.companyId;
    const desde = dto.desde ? new Date(dto.desde) : undefined;
    const hasta = dto.hasta ? new Date(dto.hasta) : undefined;
    await this.service.log({
      ...(companyId ? { companyId } : {}),
      usuarioId: user.sub,
      usuario: user.email,
      accion: 'Auditoría exportada',
      detalle: `${dto.desde?.slice(0, 10) ?? 'inicio'} → ${dto.hasta?.slice(0, 10) ?? 'hoy'}`,
    });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="auditoria-${fecha}.csv"`,
    );
    for await (const chunk of this.service.exportarCsv(
      companyId,
      desde,
      hasta,
    )) {
      res.write(chunk);
    }
    res.end();
  }

  @Get('retencion')
  @PortalOnly('CLIENTE')
  @Roles(Role.ADMIN_CLIENTE)
  retencion(@CurrentUser() user: AuthenticatedUser) {
    return this.service.retencion(user.companyId);
  }

  @Put('retencion')
  @PortalOnly('CLIENTE')
  @Roles(Role.ADMIN_CLIENTE)
  fijarRetencion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RetencionDto,
  ) {
    return this.service.fijarRetencion(user.companyId, dto.meses, user.email);
  }
}
