import {
  IsDateString,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

class ConMotivo {
  /** Why — kept in the contract's amendment history and sent to the proveedor. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  motivo: string;
}

export class ProrrogarDto extends ConMotivo {
  @IsDateString()
  vigenciaFin: string;
}

export class CambiarMontoDto extends ConMotivo {
  @IsInt()
  @Min(1)
  monto: number;
}

export class TerminarDto extends ConMotivo {}

export class ReportarAvanceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  nota: string;
}
