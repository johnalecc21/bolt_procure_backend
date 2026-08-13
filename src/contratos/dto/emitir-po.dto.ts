import { IsDateString, IsInt, Min } from 'class-validator';

export class EmitirPoDto {
  @IsInt()
  @Min(1)
  monto: number;

  @IsDateString()
  vigenciaInicio: string;

  @IsDateString()
  vigenciaFin: string;
}
