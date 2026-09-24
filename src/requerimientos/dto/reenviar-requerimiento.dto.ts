import { PrioridadRequerimiento } from '@prisma/client';
import { Type } from 'class-transformer';
import { ItemRequerimientoDto } from './create-requerimiento.dto';
import {
  ArrayMaxSize,
  IsArray,
  ValidateNested,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/** What the solicitante can correct after a rejection; omitted fields keep their value. */
export class ReenviarRequerimientoDto {
  @IsString()
  @MinLength(3)
  @IsOptional()
  titulo?: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  montoEstimado?: number;

  @IsISO8601()
  @IsOptional()
  fechaLimite?: string;

  @IsString()
  @IsOptional()
  centroCostoId?: string;

  @IsEnum(PrioridadRequerimiento)
  @IsOptional()
  prioridad?: PrioridadRequerimiento;

  /** Replaces the bill of quantities; [] removes it (lump-sum offers). */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemRequerimientoDto)
  @IsOptional()
  items?: ItemRequerimientoDto[];
}
