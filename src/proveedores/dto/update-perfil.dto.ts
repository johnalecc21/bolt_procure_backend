import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdatePerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  nombre?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categorias?: string[];

  @IsOptional()
  @IsString()
  ubicacion?: string;
}
