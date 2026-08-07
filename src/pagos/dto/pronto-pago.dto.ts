import { IsInt, Max, Min } from 'class-validator';

export class ProntoPagoDto {
  @IsInt()
  @Min(5)
  @Max(45)
  diasAdelanto: number;
}
