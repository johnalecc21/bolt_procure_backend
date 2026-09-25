import {
  IsBoolean,
  IsNumber,
  Max,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TipoPlantilla } from '@prisma/client';

export class SubidaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tamanoBytes?: number;
}

export class ConfirmarPlantillaDto {
  @IsString()
  path: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  archivoNombre: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nombre: string;

  @IsEnum(TipoPlantilla)
  tipo: TipoPlantilla;

  /** Only for this purchase category; empty = all. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoria?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  tamanoBytes?: number;
}

export class ActivarDto {
  @IsBoolean()
  activa: boolean;
}

export class VistaPreviaDto {
  @IsOptional()
  @IsString()
  contratoId?: string;

  @IsOptional()
  @IsIn(['pdf', 'docx'])
  formato?: 'pdf' | 'docx';
}

export class EjemploDto {
  @IsEnum(TipoPlantilla)
  tipo: TipoPlantilla;
}

const opcional = (max: number) => [IsOptional(), IsString(), MaxLength(max)];
function Texto(max: number): PropertyDecorator {
  return (target, key) => opcional(max).forEach((d) => d(target, key));
}

export class MarcaDto {
  @Texto(200) razonSocial?: string;
  @Texto(30) nit?: string;
  @Texto(200) direccion?: string;
  @Texto(100) ciudad?: string;
  @Texto(60) telefono?: string;
  @Texto(120) email?: string;
  @Texto(200) sitioWeb?: string;
  @Texto(120) representanteLegal?: string;
  @Texto(120) cargoRepresentante?: string;

  @IsOptional()
  @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'Color inválido (usa #RRGGBB).' })
  colorPrimario?: string;

  @Texto(20000) clausulas?: string;
  @Texto(300) piePagina?: string;

  // Penalty clause: the company decides whether there is one and writes it.
  @IsOptional()
  @IsBoolean()
  penalidadActiva?: boolean;

  /** % per day of delay (0.5 = 0,5 %). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(10)
  penalidadDiaria?: number;

  /** Cap as % of the contract value. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  penalidadTope?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  penalidadDiasGracia?: number;

  @IsOptional()
  @IsIn(['HITO', 'CONTRATO'])
  penalidadBase?: 'HITO' | 'CONTRATO';

  @Texto(5000) penalidadTexto?: string;
}

export class LogoDto {
  @IsString()
  path: string;
}
