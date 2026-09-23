import { ArrayMaxSize, IsArray, IsEnum } from 'class-validator';
import { CategoriaDocumento } from '@prisma/client';

export class UpdateRequisitosDto {
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(CategoriaDocumento, { each: true })
  categorias: CategoriaDocumento[];
}
