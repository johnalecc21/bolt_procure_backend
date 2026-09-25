import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { PlantillasService } from './plantillas.service';
import {
  ActivarDto,
  ConfirmarPlantillaDto,
  EjemploDto,
  LogoDto,
  MarcaDto,
  SubidaDto,
  VistaPreviaDto,
} from './dto/plantillas.dto';

/** Sends a generated file as a download. */
export function archivo(
  res: Response,
  f: { contenido: Buffer; nombre: string; mime: string },
) {
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `attachment; filename="${f.nombre}"`,
    'Access-Control-Expose-Headers':
      'Content-Disposition, X-Datos-Reales, X-Plantilla',
  });
  return new StreamableFile(f.contenido);
}

/** Company templates and letterhead: legal/admin decisions. */
@ApiTags('plantillas')
@PortalOnly('CLIENTE')
@Roles(Role.ADMIN_CLIENTE)
@Controller('plantillas')
export class PlantillasController {
  constructor(private service: PlantillasService) {}

  @Get()
  listar(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listar(user.companyId);
  }

  @Get('ejemplo')
  ejemplo(@Query() dto: EjemploDto, @Res({ passthrough: true }) res: Response) {
    return archivo(res, this.service.ejemplo(dto.tipo));
  }

  @Post('upload-url')
  subida(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubidaDto) {
    return this.service.urlSubida(user.companyId, dto);
  }

  @Post()
  confirmar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmarPlantillaDto,
  ) {
    return this.service.confirmar(user.companyId, dto, user.email);
  }

  @Patch(':id')
  activar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ActivarDto,
  ) {
    return this.service.activar(user.companyId, id, dto.activa, user.email);
  }

  @Delete(':id')
  eliminar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.eliminar(user.companyId, id, user.email);
  }

  @Get(':id/url')
  descargar(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.urlDescarga(user.companyId, id);
  }

  @Get(':id/vista-previa')
  async vistaPrevia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() dto: VistaPreviaDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.service.vistaPrevia(
      user.companyId,
      id,
      dto.contratoId,
      dto.formato,
    );
    res.set('X-Datos-Reales', f.conDatosReales ? '1' : '0');
    return archivo(res, f);
  }

  // ---------------------------------------------------------------- marca

  @Roles(Role.ADMIN_CLIENTE, Role.COMPRADOR, Role.APROBADOR_CFO)
  @Get('marca')
  marca(@CurrentUser() user: AuthenticatedUser) {
    return this.service.obtenerMarca(user.companyId);
  }

  @Put('marca')
  guardarMarca(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarcaDto) {
    return this.service.guardarMarca(user.companyId, dto, user.email);
  }

  @Post('marca/logo/upload-url')
  subidaLogo(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubidaDto) {
    return this.service.urlSubidaLogo(user.companyId, dto);
  }

  @Put('marca/logo')
  logo(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoDto) {
    return this.service.confirmarLogo(user.companyId, dto.path, user.email);
  }

  @Delete('marca/logo')
  quitarLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.service.confirmarLogo(user.companyId, null, user.email);
  }
}
