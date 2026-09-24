import { IsString } from 'class-validator';

/** Price and terms are taken server-side from the offer (or the final negotiated bid). */
export class CreateAdjudicacionDto {
  @IsString()
  requerimientoId: string;

  @IsString()
  proveedorId: string;
}
