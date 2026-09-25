import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class ConfirmUploadDto {
  @IsString()
  @MinLength(1)
  path: string;

  /** Expiry of this document (certificates, policies, Cámara de Comercio…). */
  @IsOptional()
  @IsISO8601()
  vigencia?: string;
}
