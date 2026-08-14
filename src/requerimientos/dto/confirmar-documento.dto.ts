import { IsString, MinLength } from 'class-validator';

export class ConfirmarDocumentoDto {
  @IsString()
  @MinLength(1)
  path: string;
}
