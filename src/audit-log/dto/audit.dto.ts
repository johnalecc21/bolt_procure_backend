import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { RETENCION_MAX_MESES, RETENCION_MIN_MESES } from '../audit-csv.util';

export class ExportarAuditoriaDto {
  @IsOptional()
  @IsISO8601()
  desde?: string;

  @IsOptional()
  @IsISO8601()
  hasta?: string;
}

export class RetencionDto {
  @Type(() => Number)
  @IsInt()
  @Min(RETENCION_MIN_MESES)
  @Max(RETENCION_MAX_MESES)
  meses: number;
}
