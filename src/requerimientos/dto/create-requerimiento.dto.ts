import { IsInt, IsISO8601, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateRequerimientoDto {
  @IsString()
  @MinLength(3)
  titulo: string;

  @IsString()
  categoria: string;

  @IsInt()
  @Min(0)
  montoEstimado: number;

  @IsISO8601()
  fechaLimite: string;

  @IsObject()
  @IsOptional()
  criteriosPeso?: Record<string, number>;
}
