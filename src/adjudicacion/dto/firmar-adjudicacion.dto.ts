import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AdjudicacionObjetivoDto {
  /** Which award of the requerimiento; optional when it has only one. */
  @IsOptional()
  @IsString()
  adjudicacionId?: string;
}

export class FirmarAdjudicacionDto extends AdjudicacionObjetivoDto {
  @IsOptional()
  @IsBoolean()
  notificarPerdedores?: boolean;
}
