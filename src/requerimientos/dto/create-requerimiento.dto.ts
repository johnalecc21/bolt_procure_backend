import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class EspecificacionDto {
  @IsString()
  name: string;

  @IsString()
  value: string;
}

export class CreateRequerimientoDto {
  @IsString()
  @MinLength(3)
  titulo: string;

  @IsString()
  @IsOptional()
  descripcion?: string;

  @IsString()
  categoria: string;

  @IsInt()
  @Min(0)
  montoEstimado: number;

  @IsISO8601()
  fechaLimite: string;

  @IsObject()
  @IsOptional()
  criteriosPeso?: Record<string, number>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EspecificacionDto)
  @IsOptional()
  especificaciones?: EspecificacionDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  proveedorIds?: string[];
}
