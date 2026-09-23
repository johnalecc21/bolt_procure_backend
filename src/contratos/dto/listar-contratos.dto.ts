import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoContrato } from '@prisma/client';
import { BusquedaPaginadaDto } from '../../common/dto/pagination.dto';

export class ListarContratosDto extends BusquedaPaginadaDto {
  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsEnum(EstadoContrato)
  estado?: EstadoContrato;
}
