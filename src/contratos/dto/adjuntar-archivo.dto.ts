import { IsString, MinLength } from 'class-validator';

export class AdjuntarArchivoDto {
  @IsString()
  @MinLength(1)
  path: string;

  @IsString()
  @MinLength(1)
  nombre: string;
}
