import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ValidarDocumentoDto {
  @IsBoolean()
  valido: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
