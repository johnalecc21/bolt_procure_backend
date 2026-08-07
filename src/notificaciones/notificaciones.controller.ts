import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificacionesService } from './notificaciones.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('notificaciones')
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private service: NotificacionesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.sub);
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
