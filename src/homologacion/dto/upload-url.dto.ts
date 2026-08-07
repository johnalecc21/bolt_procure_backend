import { IsString, MinLength } from 'class-validator';

export class UploadUrlDto {
  @IsString()
  @MinLength(1)
  filename: string;
}
