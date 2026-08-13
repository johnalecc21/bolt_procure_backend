import { IsInt, Min } from 'class-validator';

export class UpdateConfigDto {
  @IsInt()
  @Min(0)
  umbralContratoMarco: number;
}
