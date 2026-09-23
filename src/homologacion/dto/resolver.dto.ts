import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ResolverDto {
  @IsIn(['APROBADO', 'RECHAZADO'])
  estado: 'APROBADO' | 'RECHAZADO';

  // Optional override — by default resolver() uses the score already computed
  // by HomologacionScoringService when the proveedor submitted (enviar()).
  // Compliance can still override it manually if their review disagrees.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}
