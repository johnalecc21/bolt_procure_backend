import { IsString, MinLength } from 'class-validator';

export class ImpersonarDto {
  @IsString()
  @MinLength(3)
  motivo: string;
}
