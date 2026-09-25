import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  /** Tax id (NIT/RUT/RFC) as the buyers' ERPs know the company. "" clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9A-Za-z.\- ]*$/, {
    message: 'El NIT solo puede tener números, letras, puntos y guiones.',
  })
  nit?: string;

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
