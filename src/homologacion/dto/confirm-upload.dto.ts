import { IsString, MinLength } from 'class-validator';

export class ConfirmUploadDto {
  @IsString()
  @MinLength(1)
  path: string;
}
