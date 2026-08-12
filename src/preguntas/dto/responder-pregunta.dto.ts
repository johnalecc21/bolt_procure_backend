import { IsString, MinLength } from 'class-validator';

export class ResponderPreguntaDto {
  @IsString()
  @MinLength(2)
  respuesta: string;
}
