import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContratosService } from './contratos.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('contratos')
@PortalOnly('CLIENTE')
@Controller('contratos')
export class ContratosController {
  constructor(private service: ContratosService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoria') categoria?: string,
    @Query('q') query?: string,
  ) {
    return this.service.list(user.companyId, { categoria, query });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }
}
