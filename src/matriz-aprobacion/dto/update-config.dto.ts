import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { Moneda } from '@prisma/client';

export class UpdateConfigDto {
  @IsInt()
  @Min(0)
  umbralContratoMarco: number;

  @IsOptional()
  @IsEnum(Moneda)
  monedaBase?: Moneda;

  /** ISO-3166 alpha-2 (CO, MX, PE, CL, BR, GT...). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  pais?: string;

  /** Show losing suppliers their price rank and gap to the awarded price. */
  @IsOptional()
  @IsBoolean()
  feedbackCompetitivo?: boolean;
}
