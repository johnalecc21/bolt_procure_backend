import { IsEmail, IsString, MinLength } from 'class-validator';

export class CrearClienteDto {
  @IsString()
  @MinLength(2)
  nombreEmpresa: string;

  @IsString()
  @MinLength(2)
  adminNombre: string;

  @IsEmail()
  adminEmail: string;
}
