import { Module } from '@nestjs/common';
import { InternoService } from './interno.service';
import { InternoController } from './interno.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [InternoController],
  providers: [InternoService],
})
export class InternoModule {}
