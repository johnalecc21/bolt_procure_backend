import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PreguntasService } from './preguntas.service';
import { CreatePreguntaDto } from './dto/create-pregunta.dto';
import { ResponderPreguntaDto } from './dto/responder-pregunta.dto';
import type { AuthenticatedUser } from '../auth/types';

// No class-level @PortalOnly: GET is shared (list() branches on user.portal —
// proveedor sees their own questions, cliente sees every question on the
// proceso), while the write routes below are portal-restricted individually.
@ApiTags('preguntas')
@Controller('preguntas')
export class PreguntasController {
  constructor(private service: PreguntasService) {}

  @Get(':requerimientoId')
  list(@CurrentUser() user: AuthenticatedUser, @Param('requerimientoId') requerimientoId: string) {
    return this.service.list(user, requerimientoId);
  }

  @PortalOnly('PROVEEDOR')
  @Post(':requerimientoId')
  preguntar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requerimientoId') requerimientoId: string,
    @Body() dto: CreatePreguntaDto,
  ) {
    return this.service.preguntar(user.sub, requerimientoId, dto.pregunta);
  }

  @PortalOnly('CLIENTE')
  @Post(':id/responder')
  responder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResponderPreguntaDto,
  ) {
    return this.service.responder(user.companyId, user.sub, user.email, id, dto.respuesta);
  }
}
