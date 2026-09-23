/**
 * Shape of the "Cuestionario de Homologación de Proveedores" (secciones 1-6 y 8).
 * Persisted as-is on Homologacion.cuestionario (Json). Every field is optional
 * because it's saved as a draft while the proveedor fills it in section by
 * section — completeness is enforced separately at `enviar()` time, not here.
 *
 * Mirrors src/lib/api/homologacion.ts's `HomologacionCuestionario` on the frontend.
 */
export interface ReferenciaComercial {
  empresa?: string;
  contacto?: string;
  telefono?: string;
  tiempoRelacion?: string;
}

export interface HomologacionCuestionario {
  // 1. Información general
  razonSocial?: string;
  nombreComercial?: string;
  nitRut?: string;
  paisConstitucion?: string;
  direccion?: string;
  ciudadPais?: string;
  telefono?: string;
  correoContacto?: string;
  sitioWeb?: string;
  representanteLegal?: string;
  cargoRepresentante?: string;
  tipoProveedor?: 'bienes' | 'servicios' | 'ambos';
  bienServicioOfrecido?: string;

  // 2. Información legal
  fechaConstitucion?: string;
  numeroMatricula?: string;
  vigenciaMatricula?: string;
  tienePoderes?: boolean;
  esPep?: boolean;
  sancionado?: boolean;
  sancionadoDetalle?: string;
  litigios?: boolean;
  litigiosDetalle?: string;
  listaRestrictiva?: boolean;

  // 3. Información financiera
  ingresosAnioMenos1?: number;
  ingresosAnioMenos2?: number;
  patrimonio?: number;
  /// Ratio pasivo/activo, 0-1 (ej. 0.45 = 45% de endeudamiento).
  endeudamiento?: number;
  entidadBancaria?: string;
  cuentaBancaria?: string;
  tieneEstadosFinancierosAuditados?: boolean;
  firmaAuditora?: string;

  // 4. Información comercial y referencias
  referencias?: ReferenciaComercial[];

  // 5. Experiencia y capacidad operativa
  aniosExperienciaMercado?: number;
  aniosExperienciaBienServicio?: number;
  numeroEmpleados?: number;
  capacidadInstalada?: string;
  coberturaGeografica?: string;
  proyectosSimilares?: string;
  subcontrata?: boolean;
  subcontrataDetalle?: string;

  // 6. Seguridad, calidad y compliance
  politicaSst?: boolean;
  polizasVigentes?: boolean;
  polizasVigenciaDetalle?: string;
  certificacionesCalidad?: boolean;
  certificacionesCalidadCuales?: string;
  politicaAnticorrupcion?: boolean;
  politicaProteccionDatos?: boolean;
  incidentesGraves?: boolean;
  incidentesDetalle?: string;

  // 8. Declaración y firma
  declaracionAceptada?: boolean;
  firmanteNombre?: string;
  firmanteCargo?: string;
  firmaFecha?: string;
}

export interface ScoreDesglose {
  financiero: number;
  legal: number;
  compliance: number;
  tecnico: number;
  operacional: number;
  comercial: number;
}

/** Campos mínimos exigidos antes de poder enviar a validación (paso "¿Información completa y conforme?"). */
export const CUESTIONARIO_REQUIRED_FIELDS: { key: keyof HomologacionCuestionario; label: string }[] = [
  { key: 'razonSocial', label: 'Razón social' },
  { key: 'nitRut', label: 'NIT / RUT / Tax ID' },
  { key: 'representanteLegal', label: 'Representante legal' },
  { key: 'tipoProveedor', label: 'Tipo de proveedor' },
  { key: 'bienServicioOfrecido', label: 'Bien o servicio ofrecido' },
  { key: 'fechaConstitucion', label: 'Fecha de constitución de la empresa' },
  { key: 'numeroMatricula', label: 'N° de matrícula / Cámara de Comercio' },
  { key: 'esPep', label: '¿Es Persona Expuesta Políticamente (PEP)?' },
  { key: 'sancionado', label: '¿Ha sido sancionada en los últimos 5 años?' },
  { key: 'litigios', label: '¿Existen litigios en curso?' },
  { key: 'listaRestrictiva', label: '¿Aparece en listas restrictivas?' },
  { key: 'tieneEstadosFinancierosAuditados', label: '¿Cuenta con estados financieros auditados?' },
  { key: 'ingresosAnioMenos1', label: 'Ingresos operacionales año -1' },
  { key: 'aniosExperienciaMercado', label: 'Años de experiencia en el mercado' },
  { key: 'numeroEmpleados', label: 'N° de empleados' },
  { key: 'coberturaGeografica', label: 'Cobertura geográfica' },
  { key: 'politicaSst', label: 'Política de Seguridad y Salud en el Trabajo' },
  { key: 'polizasVigentes', label: 'Pólizas de responsabilidad civil / cumplimiento' },
  { key: 'certificacionesCalidad', label: 'Certificaciones de calidad' },
  { key: 'politicaAnticorrupcion', label: 'Política anticorrupción / antisoborno' },
  { key: 'politicaProteccionDatos', label: 'Política de protección de datos personales' },
  { key: 'incidentesGraves', label: 'Incidentes graves en los últimos 3 años' },
  { key: 'declaracionAceptada', label: 'Declaración y firma' },
  { key: 'firmanteNombre', label: 'Nombre del firmante' },
];

/** Returns the labels of every required field still missing/unset. Empty array = complete. */
export function camposFaltantes(c: HomologacionCuestionario | null | undefined): string[] {
  const cuestionario = c ?? {};
  const faltantes = CUESTIONARIO_REQUIRED_FIELDS.filter(({ key }) => {
    const value = cuestionario[key];
    return value === undefined || value === null || value === '';
  }).map(({ label }) => label);

  const referencias = (cuestionario.referencias ?? []).filter(
    (r) => r.empresa?.trim() && r.contacto?.trim() && r.telefono?.trim(),
  );
  if (referencias.length < 3) {
    faltantes.push('Mínimo 3 referencias comerciales completas (empresa, contacto y teléfono)');
  }

  return faltantes;
}
