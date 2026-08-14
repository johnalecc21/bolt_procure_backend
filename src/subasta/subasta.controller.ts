import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubastaService } from './subasta.service';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('subasta')
@Controller('subasta')
export class SubastaController {
  constructor(private service: SubastaService) {}

  @Get(':requerimientoId')
  async getState(@CurrentUser() user: AuthenticatedUser, @Param('requerimientoId') requerimientoId: string) {
    const proveedorId = user.portal === 'PROVEEDOR' ? await this.service.proveedorIdForUser(user.sub) : undefined;
    const viewer = { portal: user.portal, companyId: user.companyId, proveedorId };
    const allowed = await this.service.canView(requerimientoId, viewer);
    if (!allowed) {
      throw new ForbiddenException('No tienes acceso a esta subasta.');
    }
    const state = await this.service.getState(requerimientoId);
    return this.service.buildView(state, viewer);
  }
}
