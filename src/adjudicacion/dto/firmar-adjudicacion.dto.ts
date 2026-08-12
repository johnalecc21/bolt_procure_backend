import { IsBoolean, IsOptional } from 'class-validator';

export class FirmarAdjudicacionDto {
  @IsOptional()
  @IsBoolean()
  notificarPerdedores?: boolean;
}
