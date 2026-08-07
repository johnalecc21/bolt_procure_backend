import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ResolverDto {
  @IsIn(['APROBADO', 'RECHAZADO'])
  estado: 'APROBADO' | 'RECHAZADO';

  @IsInt()
  @Min(0)
  @Max(100)
  score: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}
