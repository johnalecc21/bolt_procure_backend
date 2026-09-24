import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnaliticaService } from './analitica.service';
import { CrearGraficaDto, PeriodoAnaliticaDto } from './dto/analitica.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('analitica')
@PortalOnly('CLIENTE')
@Roles(Role.APROBADOR_CFO, Role.ADMIN_CLIENTE)
@Controller('analitica')
export class AnaliticaController {
  constructor(private service: AnaliticaService) {}

  /** Row-level dataset behind every KPI, chart and export of the CFO dashboard. */
  @Get('cfo')
  cfo(
    @CurrentUser() user: AuthenticatedUser,
    @Query() periodo: PeriodoAnaliticaDto,
  ) {
    return this.service.cfo(user.companyId, periodo);
  }

  @Get('graficas')
  listarGraficas(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listarGraficas(user.companyId, user.sub);
  }

  @Post('graficas')
  crearGrafica(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CrearGraficaDto,
  ) {
    return this.service.crearGrafica(user.companyId, user.sub, dto);
  }

  @Delete('graficas/:id')
  eliminarGrafica(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.eliminarGrafica(user.companyId, user.sub, id);
  }
}
