import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateHitoDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsDateString()
  comprometido: string;
}
