import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { BusquedaPaginadaDto } from '../../common/dto/pagination.dto';

export class ListarProveedoresDto extends BusquedaPaginadaDto {
  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;
}
