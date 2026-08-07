import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';

@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private service: AuditLogService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.service.list(limit ? Number(limit) : undefined);
  }
}
