import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Moneda, TipoUnidadNegocio } from '@prisma/client';

const CODIGO = /^[A-Za-z0-9._-]{1,20}$/;

export class UnidadNegocioDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre: string;

  @IsString()
  @Matches(CODIGO, {
    message:
      'El código solo admite letras, números, punto, guion y guion bajo (máx. 20).',
  })
  codigo: string;

  @IsOptional()
  @IsEnum(TipoUnidadNegocio)
  tipo?: TipoUnidadNegocio;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class CentroCostoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre: string;

  @IsString()
  @Matches(CODIGO, {
    message:
      'El código solo admite letras, números, punto, guion y guion bajo (máx. 20).',
  })
  codigo: string;

  /** Empty string detaches it from any unit. */
  @IsOptional()
  @IsString()
  unidadNegocioId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  responsable?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class PresupuestoDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monto: number;

  @IsEnum(Moneda)
  moneda: Moneda;
}

export class AnioParam {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anio: number;
}

export class ConfigEstructuraDto {
  @IsBoolean()
  exigeCentroCosto: boolean;
}
