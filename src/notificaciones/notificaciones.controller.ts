import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificacionesService } from './notificaciones.service';
import type { AuthenticatedUser } from '../auth/types';

class PreferenciasDto {
  @IsBoolean()
  recibirCorreos: boolean;
}

@ApiTags('notificaciones')
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private service: NotificacionesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.sub);
  }

  // Registered before ':id/leer' only for readability — different verbs/paths don't collide.
  @Get('preferencias')
  preferencias(@CurrentUser() user: AuthenticatedUser) {
    return this.service.preferencias(user.sub);
  }

  @Put('preferencias')
  fijarPreferencias(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreferenciasDto) {
    return this.service.fijarPreferencias(user.sub, dto.recibirCorreos);
  }

  @Post(':id/leer')
  markAsRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.markAsRead(user.sub, id);
  }

  @Post('leer-todas')
  markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.service.markAllAsRead(user.sub);
  }
}
