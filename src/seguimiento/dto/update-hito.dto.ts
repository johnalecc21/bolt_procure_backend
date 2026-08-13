import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { EstadoHito } from '@prisma/client';

export class UpdateHitoDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsDateString()
  comprometido?: string;

  @IsOptional()
  @IsEnum(EstadoHito)
  estado?: EstadoHito;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  porcentaje?: number;
}
