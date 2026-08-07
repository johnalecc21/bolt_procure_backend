import { IsString, MinLength } from 'class-validator';

export class AddMensajeDto {
  @IsString()
  @MinLength(1)
  texto: string;
}
