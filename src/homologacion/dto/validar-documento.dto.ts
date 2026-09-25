import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ValidarDocumentoDto {
  @IsBoolean()
  valido: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;

  /** Compliance can set or correct the expiry when validating. */
  @IsOptional()
  @IsISO8601()
  vigencia?: string;
}
