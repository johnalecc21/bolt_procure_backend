import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ExtenderPlazoDto {
  @IsInt()
  @Min(1)
  dias: number;

  @IsOptional()
  @IsString()
  motivo?: string;
}
