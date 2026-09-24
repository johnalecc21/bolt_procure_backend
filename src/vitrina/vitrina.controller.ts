import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { VitrinaService } from './vitrina.service';
import {
  CrearArchivoVitrinaDto,
  ItemCatalogoDto,
  UpdateVitrinaDto,
  VitrinaUploadUrlDto,
} from './dto/vitrina.dto';

@ApiTags('vitrina')
@Controller('vitrina')
export class VitrinaController {
  constructor(private service: VitrinaService) {}

  // 'mine' routes are registered before the public ':id' one so they don't collide.
  @PortalOnly('PROVEEDOR')
  @Get('mine')
  mia(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mia(user.sub);
  }

  @PortalOnly('PROVEEDOR')
  @Patch('mine')
  actualizar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateVitrinaDto,
  ) {
    return this.service.actualizar(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Post('mine/upload-url')
  crearUrlSubida(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VitrinaUploadUrlDto,
  ) {
    return this.service.crearUrlSubida(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Post('mine/archivos')
  crearArchivo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CrearArchivoVitrinaDto,
  ) {
    return this.service.crearArchivo(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Delete('mine/archivos/:id')
  eliminarArchivo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.eliminarArchivo(user.sub, id);
  }

  @PortalOnly('PROVEEDOR')
  @Post('mine/items')
  crearItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ItemCatalogoDto,
  ) {
    return this.service.crearItem(user.sub, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Put('mine/items/:id')
  actualizarItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ItemCatalogoDto,
  ) {
    return this.service.actualizarItem(user.sub, id, dto);
  }

  @PortalOnly('PROVEEDOR')
  @Delete('mine/items/:id')
  eliminarItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.eliminarItem(user.sub, id);
  }

  /** Ids of every public vitrina — feeds the frontend's sitemap-vitrinas.xml. */
  @Public()
  @Get('sitemap')
  sitemap() {
    return this.service.sitemap();
  }

  /** Public showcase — shareable, no login. */
  @Public()
  @Get(':id')
  publica(@Param('id') id: string) {
    return this.service.publica(id);
  }
}
