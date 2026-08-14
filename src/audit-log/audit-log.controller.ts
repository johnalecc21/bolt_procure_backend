import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuditLogService } from './audit-log.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private service: AuditLogService) {}

  // Shared by two different frontends (Contratos.tsx for cliente,
  // AdminClientes.tsx for interno) with very different visibility: a cliente
  // only ever sees their own company's trail, interno sees every company's
  // (that's the point of the impersonation audit trail). Proveedor has no
  // legitimate use for this endpoint at all.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() { page = 1, limit = 20 }: PaginationQueryDto) {
    if (user.portal === 'PROVEEDOR') {
      throw new ForbiddenException('Este recurso no está disponible en este portal.');
    }
    const companyId = user.portal === 'INTERNO' ? null : user.companyId;
    return this.service.list(companyId, page, limit);
  }
}
