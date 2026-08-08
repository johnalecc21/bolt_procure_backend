import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
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
}
