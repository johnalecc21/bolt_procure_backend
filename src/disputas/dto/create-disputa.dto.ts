import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDisputaDto {
  @IsString()
  poReferencia: string;

  @IsOptional()
  @IsString()
  proveedorId?: string;

  @IsIn(['BAJA', 'MEDIA', 'ALTA'])
  severidad: 'BAJA' | 'MEDIA' | 'ALTA';

  @IsString()
  @MinLength(3)
  descripcion: string;
}
