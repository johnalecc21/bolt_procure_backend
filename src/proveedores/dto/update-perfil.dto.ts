import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitioWeb?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  certificaciones?: string[];
}
