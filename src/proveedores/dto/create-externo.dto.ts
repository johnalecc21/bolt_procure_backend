import { IsString, MinLength } from 'class-validator';

export class CreateExternoDto {
  @IsString()
  @MinLength(2)
  nombre: string;

  @IsString()
  email: string;
}
