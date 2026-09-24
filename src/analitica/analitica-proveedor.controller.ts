import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PortalOnly } from '../common/decorators/portal.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnaliticaProveedorService } from './analitica-proveedor.service';
import { PeriodoAnaliticaDto } from './dto/analitica.dto';
import type { AuthenticatedUser } from '../auth/types';

@ApiTags('analitica')
@PortalOnly('PROVEEDOR')
@Controller('analitica/proveedor')
export class AnaliticaProveedorController {
  constructor(private service: AnaliticaProveedorService) {}

  /** The supplier's own rows behind "Mi desempeño". */
  @Get()
  datos(
    @CurrentUser() user: AuthenticatedUser,
    @Query() periodo: PeriodoAnaliticaDto,
  ) {
    return this.service.datos(user.sub, periodo);
  }
}
