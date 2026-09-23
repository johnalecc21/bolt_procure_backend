import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEvaluacionDto {
  @IsString()
  contratoId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  calidad: number;

  @IsInt()
  @Min(1)
  @Max(5)
  plazos: number;

  @IsInt()
  @Min(1)
  @Max(5)
  servicio: number;

  @IsInt()
  @Min(1)
  @Max(5)
  hse: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comentario?: string;
}
