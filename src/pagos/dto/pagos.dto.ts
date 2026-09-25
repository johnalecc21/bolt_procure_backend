import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UploadArchivoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024)
  tamanoBytes?: number;
}

export class RadicarFacturaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  numero: string;

  @IsISO8601()
  fechaEmision: string;

  @IsString()
  @MinLength(1)
  path: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre: string;
}

export class MotivoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo: string;
}

export class RegistrarPagoDto {
  @IsISO8601()
  fechaPago: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  referencia: string;

  @IsOptional()
  @IsString()
  soportePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  soporteNombre?: string;
}
