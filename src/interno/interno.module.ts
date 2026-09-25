import { Module } from '@nestjs/common';
import { InternoService } from './interno.service';
import { InternoController } from './interno.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PlanesModule } from '../planes/planes.module';

@Module({
  imports: [AuditLogModule, PlanesModule],
  controllers: [InternoController],
  providers: [InternoService],
})
export class InternoModule {}
