import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ContratosService } from './contratos.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('contratos')
@Controller('contratos')
export class ContratosController {
  constructor(private service: ContratosService) {}

  // Registered before ':id' so "mine" isn't swallowed as a company-scoped contract id.
  @PortalOnly('PROVEEDOR')
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Get('mine/:id')
  findOneMine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOneMine(user.sub, id);
  }

  @PortalOnly('CLIENTE')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('categoria') categoria?: string,
    @Query('q') query?: string,
  ) {
    return this.service.list(user.companyId, { categoria, query });
  }

  @PortalOnly('CLIENTE')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }
}
