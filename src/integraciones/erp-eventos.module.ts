import { Global, Module } from '@nestjs/common';
import { ErpEventosService } from './erp-eventos.service';

/** Global so every domain module can queue documents without import cycles. */
@Global()
@Module({
  providers: [ErpEventosService],
  exports: [ErpEventosService],
})
export class ErpEventosModule {}
