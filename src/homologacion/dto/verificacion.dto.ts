import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ResultadoLista } from '@prisma/client';

export class RegistrarVerificacionDto {
  @IsString()
  @MaxLength(40)
  lista: string;

  @IsIn([ResultadoLista.SIN_COINCIDENCIA, ResultadoLista.COINCIDENCIA])
  resultado: ResultadoLista;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detalle?: string;
}
