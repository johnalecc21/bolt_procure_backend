import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { NavegacionService } from './navegacion.service';

@ApiTags('navegacion')
@Controller('navegacion')
export class NavegacionController {
  constructor(private service: NavegacionService) {}

  /** Pending counters for the side menu of the caller's portal. */
  @Get('contadores')
  contadores(@CurrentUser() user: AuthenticatedUser) {
    return this.service.contadores(user);
  }
}
