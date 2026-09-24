import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ActualizarPerfilDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsOptional()
  nombre?: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  cargo?: string;
}
