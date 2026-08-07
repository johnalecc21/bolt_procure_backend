import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PagosService } from './pagos.service';
import { ProntoPagoDto } from './dto/pronto-pago.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('pagos')
@PortalOnly('PROVEEDOR')
@Controller('pagos')
export class PagosController {
  constructor(private service: PagosService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user.sub);
  }

  @Post(':id/pronto-pago')
  simular(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProntoPagoDto,
  ) {
    return this.service.simularProntoPago(user.sub, id, dto.diasAdelanto);
  }
}
