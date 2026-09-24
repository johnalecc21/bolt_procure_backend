import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PrecioItemDto {
  @IsString()
  itemId: string;

  /** Unit price for the line; omit the line entirely to not quote it. */
  @IsInt()
  @Min(0)
  precioUnitario: number;
}

export class UpsertOfertaDto {
  @IsString()
  requerimientoId: string;

  @IsInt()
  @Min(0)
  precioUnitario: number;

  @IsInt()
  @Min(0)
  precioTotal: number;

  /**
   * Required on an itemized requerimiento: one price per quoted line. The
   * totals above are then ignored and computed server-side from these.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PrecioItemDto)
  items?: PrecioItemDto[];

  @IsInt()
  @Min(1)
  plazoEntregaDias: number;

  @IsInt()
  @Min(0)
  condicionesPagoDias: number;

  @IsInt()
  @Min(0)
  garantiaMeses: number;

  @IsInt()
  @Min(1)
  vigenciaOfertaDias: number;
}
