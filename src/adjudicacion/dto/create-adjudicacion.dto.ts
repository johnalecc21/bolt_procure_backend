import { IsInt, IsString, Min } from 'class-validator';

export class CreateAdjudicacionDto {
  @IsString()
  requerimientoId: string;

  @IsString()
  proveedorId: string;

  @IsInt()
  @Min(0)
  precioFinal: number;

  @IsInt()
  @Min(1)
  plazoDias: number;

  @IsInt()
  @Min(0)
  condicionesPagoDias: number;

  @IsInt()
  @Min(0)
  garantiaMeses: number;
}
