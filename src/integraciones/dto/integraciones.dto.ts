import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  EstadoEventoErp,
  ModoIntegracion,
  TipoEventoErp,
  TipoMapeoErp,
} from '@prisma/client';

export class ActualizarIntegracionDto {
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @IsOptional()
  @IsEnum(ModoIntegracion)
  modo?: ModoIntegracion;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sistema?: string;

  /** "" clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(TipoEventoErp, { each: true })
  eventos?: TipoEventoErp[];
}

export class MapeoDto {
  @IsEnum(TipoMapeoErp)
  tipo: TipoMapeoErp;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  valorLocal: string;

  /** "" removes the mapping. */
  @IsString()
  @MaxLength(60)
  valorErp: string;
}

export class GuardarMapeosDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MapeoDto)
  mapeos: MapeoDto[];
}

export class ListarEventosDto {
  @IsOptional()
  @IsEnum(EstadoEventoErp)
  estado?: EstadoEventoErp;

  @IsOptional()
  @IsEnum(TipoEventoErp)
  tipo?: TipoEventoErp;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class RangoDto {
  @IsISO8601()
  desde: string;

  @IsISO8601()
  hasta: string;
}

export class IdsDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  ids: string[];
}

/** What the ERP (or its middleware) sends when it pays. */
export class PagoEntranteDto {
  /** Procurex payment id (id_pago in the file / pagoId in the webhook). */
  @IsOptional()
  @IsString()
  pagoId?: string;

  /** Alternative: the supplier's invoice number, plus its NIT to disambiguate. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  numeroFactura?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  nitProveedor?: string;

  @IsISO8601()
  fechaPago: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  referencia: string;
}

/** The ERP confirms it created a document and tells us its own number. */
export class AcuseDto {
  @IsString()
  eventoId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  idExterno: string;
}
