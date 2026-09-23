import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReferenciaComercialDto {
  @IsOptional() @IsString() empresa?: string;
  @IsOptional() @IsString() contacto?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() tiempoRelacion?: string;
}

/**
 * Draft-savable — every field optional, saved section by section as the
 * proveedor fills the cuestionario. Completeness is enforced separately in
 * HomologacionService.enviar() via camposFaltantes(), not here.
 */
export class CuestionarioDto {
  // 1. Información general
  @IsOptional() @IsString() razonSocial?: string;
  @IsOptional() @IsString() nombreComercial?: string;
  @IsOptional() @IsString() nitRut?: string;
  @IsOptional() @IsString() paisConstitucion?: string;
  @IsOptional() @IsString() direccion?: string;
  @IsOptional() @IsString() ciudadPais?: string;
  @IsOptional() @IsString() telefono?: string;
  @IsOptional() @IsString() correoContacto?: string;
  @IsOptional() @IsString() sitioWeb?: string;
  @IsOptional() @IsString() representanteLegal?: string;
  @IsOptional() @IsString() cargoRepresentante?: string;
  @IsOptional() @IsIn(['bienes', 'servicios', 'ambos']) tipoProveedor?: 'bienes' | 'servicios' | 'ambos';
  @IsOptional() @IsString() bienServicioOfrecido?: string;

  // 2. Información legal
  @IsOptional() @IsString() fechaConstitucion?: string;
  @IsOptional() @IsString() numeroMatricula?: string;
  @IsOptional() @IsString() vigenciaMatricula?: string;
  @IsOptional() @IsBoolean() tienePoderes?: boolean;
  @IsOptional() @IsBoolean() esPep?: boolean;
  @IsOptional() @IsBoolean() sancionado?: boolean;
  @IsOptional() @IsString() sancionadoDetalle?: string;
  @IsOptional() @IsBoolean() litigios?: boolean;
  @IsOptional() @IsString() litigiosDetalle?: string;
  @IsOptional() @IsBoolean() listaRestrictiva?: boolean;

  // 3. Información financiera
  @IsOptional() @IsNumber() @Min(0) ingresosAnioMenos1?: number;
  @IsOptional() @IsNumber() @Min(0) ingresosAnioMenos2?: number;
  @IsOptional() @IsNumber() @Min(0) patrimonio?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) endeudamiento?: number;
  @IsOptional() @IsString() entidadBancaria?: string;
  @IsOptional() @IsString() cuentaBancaria?: string;
  @IsOptional() @IsBoolean() tieneEstadosFinancierosAuditados?: boolean;
  @IsOptional() @IsString() firmaAuditora?: string;

  // 4. Información comercial y referencias
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenciaComercialDto)
  referencias?: ReferenciaComercialDto[];

  // 5. Experiencia y capacidad operativa
  @IsOptional() @IsNumber() @Min(0) aniosExperienciaMercado?: number;
  @IsOptional() @IsNumber() @Min(0) aniosExperienciaBienServicio?: number;
  @IsOptional() @IsNumber() @Min(0) numeroEmpleados?: number;
  @IsOptional() @IsString() capacidadInstalada?: string;
  @IsOptional() @IsString() coberturaGeografica?: string;
  @IsOptional() @IsString() proyectosSimilares?: string;
  @IsOptional() @IsBoolean() subcontrata?: boolean;
  @IsOptional() @IsString() subcontrataDetalle?: string;

  // 6. Seguridad, calidad y compliance
  @IsOptional() @IsBoolean() politicaSst?: boolean;
  @IsOptional() @IsBoolean() polizasVigentes?: boolean;
  @IsOptional() @IsString() polizasVigenciaDetalle?: string;
  @IsOptional() @IsBoolean() certificacionesCalidad?: boolean;
  @IsOptional() @IsString() certificacionesCalidadCuales?: string;
  @IsOptional() @IsBoolean() politicaAnticorrupcion?: boolean;
  @IsOptional() @IsBoolean() politicaProteccionDatos?: boolean;
  @IsOptional() @IsBoolean() incidentesGraves?: boolean;
  @IsOptional() @IsString() incidentesDetalle?: string;

  // 8. Declaración y firma
  @IsOptional() @IsBoolean() declaracionAceptada?: boolean;
  @IsOptional() @IsString() firmanteNombre?: string;
  @IsOptional() @IsString() firmanteCargo?: string;
  @IsOptional() @IsString() firmaFecha?: string;
}
