import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterProveedorDto {
  @IsString()
  @MinLength(2)
  razonSocial: string;

  @IsString()
  pais: string;

  @IsString()
  categoria: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
