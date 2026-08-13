import { IsDateString, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateHitoDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsDateString()
  comprometido: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  porcentaje?: number;
}
