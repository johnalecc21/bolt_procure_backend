import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { Portal } from '@prisma/client';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsEnum(Portal)
  portal: Portal;
}
