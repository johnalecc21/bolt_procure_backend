import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DIMENSIONES, METRICAS, TIPOS_GRAFICA } from '../analitica.const';

export class PeriodoAnaliticaDto {
  /** YYYY-MM-DD, inclusive. Defaults to 6 months before `hasta`. */
  @IsISO8601()
  @IsOptional()
  desde?: string;

  /** YYYY-MM-DD, inclusive. Defaults to today. */
  @IsISO8601()
  @IsOptional()
  hasta?: string;
}

export class CrearGraficaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  titulo: string;

  @IsIn(METRICAS)
  metrica: string;

  @IsIn(DIMENSIONES)
  dimension: string;

  @IsIn(TIPOS_GRAFICA)
  tipo: string;
}
