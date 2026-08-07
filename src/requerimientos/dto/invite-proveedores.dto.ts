import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class InviteProveedoresDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  proveedorIds: string[];
}
