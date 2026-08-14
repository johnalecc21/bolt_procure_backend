import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequerimientosService } from './requerimientos.service';
import { CreateRequerimientoDto } from './dto/create-requerimiento.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { UpdateEstadoDto } from './dto/update-estado.dto';
import { InviteProveedoresDto } from './dto/invite-proveedores.dto';
import { ExtenderPlazoDto } from './dto/extender-plazo.dto';
import { UploadUrlDto } from './dto/upload-url.dto';
import { ConfirmarDocumentoDto } from './dto/confirmar-documento.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('requerimientos')
@PortalOnly('CLIENTE')
@Controller('requerimientos')
export class RequerimientosController {
  constructor(private service: RequerimientosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.companyId, user.sub, user.role);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.findOne(user.companyId, id);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRequerimientoDto) {
    return this.service.create(user.companyId, user.sub, dto);
  }

  @Patch(':id/estado')
  updateEstado(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEstadoDto,
  ) {
    return this.service.updateEstado(user.companyId, id, dto.estado, user.email);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Patch(':id/extender-plazo')
  extenderPlazo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExtenderPlazoDto,
  ) {
    return this.service.extenderPlazo(user.companyId, id, dto.dias, user.email, dto.motivo);
  }

  @Post(':id/comentarios')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.service.addComment(user.companyId, id, user.email, dto.texto);
  }

  @Roles(Role.COMPRADOR, Role.ADMIN_CLIENTE)
  @Post(':id/invitaciones')
  invitarProveedores(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: InviteProveedoresDto,
  ) {
    return this.service.invitarProveedores(user.companyId, id, dto.proveedorIds);
  }

  @Post(':id/documentos/upload-url')
  crearUrlSubidaDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadUrlDto,
  ) {
    return this.service.crearUrlSubidaDocumento(user.companyId, id, dto.filename);
  }

  @Post(':id/documentos/:docId/confirmar')
  confirmarDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: ConfirmarDocumentoDto,
  ) {
    return this.service.confirmarDocumento(user.companyId, id, docId, dto.path, user.email);
  }

  @Get(':id/documentos/:docId/url')
  crearUrlDescargaDocumento(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.service.crearUrlDescargaDocumento(user.companyId, id, docId);
  }
}
