import { IsString, MinLength } from 'class-validator';

export class SolicitarInfoDto {
  @IsString()
  @MinLength(3)
  mensaje: string;
}
