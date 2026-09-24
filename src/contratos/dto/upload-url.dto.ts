import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UploadUrlDto {
  @IsString()
  @MinLength(1)
  filename: string;

  /** Size in bytes — counts toward the company's storage quota. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024)
  tamanoBytes?: number;
}
