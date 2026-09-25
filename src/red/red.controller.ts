import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { RedService } from './red.service';

class OportunidadesDto {
  @IsOptional()
  @IsString()
  todas?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

class DirectorioDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  categoria?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

class AbrirDto {
  @IsBoolean()
  abierto: boolean;
}

@ApiTags('red')
@Controller('red')
export class RedController {
  constructor(private service: RedService) {}

  /** Public: the network directory and its headline numbers. */
  @Public()
  @Get('publico/proveedores')
  directorio(@Query() dto: DirectorioDto) {
    return this.service.directorio(dto);
  }

  @Public()
  @Get('publico/estadisticas')
  estadisticas() {
    return this.service.estadisticas();
  }

  @PortalOnly('PROVEEDOR')
  @Get('oportunidades')
  oportunidades(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: OportunidadesDto,
  ) {
    return this.service.oportunidades(user.sub, {
      todas: dto.todas === '1' || dto.todas === 'true',
      q: dto.q,
    });
  }

  @PortalOnly('PROVEEDOR')
  @Post('oportunidades/:id/participar')
  participar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.participar(user.sub, id);
  }

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE, Role.APROBADOR_CFO)
  @Get('requerimientos/:id/tablero')
  tablero(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.tablero(user.companyId, id);
  }

  @PortalOnly('CLIENTE')
  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Patch('requerimientos/:id')
  abrir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AbrirDto,
  ) {
    return this.service.abrir(user.companyId, id, dto.abierto, user.email);
  }
}
