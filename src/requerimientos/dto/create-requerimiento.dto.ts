import { Type } from 'class-transformer';
import { Moneda, PrioridadRequerimiento } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  MaxLength,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EspecificacionDto {
  @IsString()
  name: string;

  @IsString()
  value: string;
}

/** One line of the bill of quantities; suppliers price each line. */
export class ItemRequerimientoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  descripcion: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  cantidad: number;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unidad: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  especificacion?: string;
}

export class CreateRequerimientoDto {
  @IsString()
  @MinLength(3)
  titulo: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  categoria: string;

  @IsInt()
  @Min(0)
  montoEstimado: number;

  /** Required when the company has exigeCentroCosto on. */
  @IsString()
  @IsOptional()
  centroCostoId?: string;

  /** Defaults to the company's monedaBase. */
  @IsEnum(Moneda)
  @IsOptional()
  moneda?: Moneda;

  @IsISO8601()
  fechaLimite: string;

  @IsEnum(PrioridadRequerimiento)
  @IsOptional()
  prioridad?: PrioridadRequerimiento;

  @IsObject()
  @IsOptional()
  criteriosPeso?: Record<string, number>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EspecificacionDto)
  @IsOptional()
  especificaciones?: EspecificacionDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  proveedorIds?: string[];

  /** Optional bill of quantities; without it the offer is a single lump sum. */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemRequerimientoDto)
  @IsOptional()
  items?: ItemRequerimientoDto[];
}
