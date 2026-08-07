import { IsEnum } from 'class-validator';
import { EstadoRequerimiento } from '@prisma/client';

export class UpdateEstadoDto {
  @IsEnum(EstadoRequerimiento)
  estado: EstadoRequerimiento;
}
