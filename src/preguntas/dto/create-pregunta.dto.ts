import { IsString, MinLength } from 'class-validator';

export class CreatePreguntaDto {
  @IsString()
  @MinLength(5)
  pregunta: string;
}
