import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AsignacionItemDto {
  @IsString()
  itemId: string;

  @IsString()
  proveedorId: string;
}

/**
 * Either one proveedor for the whole requerimiento (`proveedorId` — on an
 * itemized one, every line it quoted), or line-by-line `asignaciones` that
 * may split it across several. Price and terms are always taken server-side
 * from the offers (or the final negotiated bid).
 */
export class CreateAdjudicacionDto {
  @IsString()
  requerimientoId: string;

  @IsOptional()
  @IsString()
  proveedorId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AsignacionItemDto)
  asignaciones?: AsignacionItemDto[];
}
