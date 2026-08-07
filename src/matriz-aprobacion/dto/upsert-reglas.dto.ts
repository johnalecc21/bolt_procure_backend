import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { TipoRegla } from '@prisma/client';

export class ReglaDto {
  @IsInt()
  @Min(0)
  montoMin: number;

  @IsOptional()
  @IsInt()
  montoMax?: number;

  @IsString()
  aprobadores: string;

  @IsString()
  tipo: TipoRegla;
}

export class UpsertReglasDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReglaDto)
  reglas: ReglaDto[];
}
