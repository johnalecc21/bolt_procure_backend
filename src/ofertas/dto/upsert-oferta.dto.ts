import { IsInt, IsString, Min } from 'class-validator';

export class UpsertOfertaDto {
  @IsString()
  requerimientoId: string;

  @IsInt()
  @Min(0)
  precioUnitario: number;

  @IsInt()
  @Min(0)
  precioTotal: number;

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
