import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Role, TipoRegla } from '@prisma/client';

export class ReglaDto {
  @IsInt()
  @Min(0)
  montoMin: number;

  @IsOptional()
  @IsInt()
  montoMax?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Role, { each: true })
  roles: Role[];

  @IsEnum(TipoRegla)
  tipo: TipoRegla;
}

export class UpsertReglasDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReglaDto)
  reglas: ReglaDto[];
}
