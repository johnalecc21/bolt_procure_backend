import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoRequerimiento } from '@prisma/client';
import { BusquedaPaginadaDto } from '../../common/dto/pagination.dto';

export class ListarRequerimientosDto extends BusquedaPaginadaDto {
  @IsOptional()
  @IsEnum(EstadoRequerimiento)
  estado?: EstadoRequerimiento;

  @IsOptional()
  @IsString()
  centroCostoId?: string;
}
