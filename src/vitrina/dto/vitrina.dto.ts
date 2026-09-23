import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Moneda, TipoArchivoVitrina } from '@prisma/client';

export class UpdateVitrinaDto {
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefonoContacto?: string;

  /** Empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emailContacto?: string;

  /** YouTube / Vimeo link; empty string clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  videoUrl?: string;
}

export class VitrinaUploadUrlDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename: string;

  @IsIn(['IMAGEN', 'BROCHURE', 'CATALOGO', 'ITEM'])
  uso: TipoArchivoVitrina | 'ITEM';
}

export class CrearArchivoVitrinaDto {
  @IsEnum(TipoArchivoVitrina)
  tipo: TipoArchivoVitrina;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  titulo: string;

  @IsString()
  path: string;
}

export class ItemCatalogoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoria?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unidad?: string;

  /** Reference price in whole units; omit to show "a convenir". */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  precioReferencia?: number;

  @IsOptional()
  @IsEnum(Moneda)
  moneda?: Moneda;

  /** Path returned by the ITEM upload-url; empty string removes the photo. */
  @IsOptional()
  @IsString()
  imagenPath?: string;
}
