import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class AdjuntarArchivoDto {
  @IsString()
  @MinLength(1)
  path: string;

  @IsString()
  @MinLength(1)
  nombre: string;

  /** Size in bytes — counts toward the company's storage quota. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024)
  tamanoBytes?: number;
}
