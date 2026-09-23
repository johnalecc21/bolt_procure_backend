import { CategoriaDocumento } from '@prisma/client';

/**
 * The checklist of documents every proveedor gets during homologación,
 * aligned with sección 7 ("Documentos requeridos") of the Cuestionario de
 * Homologación de Proveedores. Seeded on the Homologacion at creation time —
 * used by BOTH the self-registration path (AuthService) and the externally-
 * added path (ProveedoresService), so it lives here to stay a single source
 * of truth instead of drifting between the two.
 *
 * The `obligatorio: false` ones never block "enviar": they add score and a
 * client company can require their category before inviting (see
 * Company.categoriasHomologacionRequeridas).
 */
export const DOCUMENTOS_HOMOLOGACION_INICIALES: {
  nombre: string;
  categoria: CategoriaDocumento;
  obligatorio: boolean;
}[] = [
  {
    nombre: 'RUT / NIT actualizado',
    categoria: CategoriaDocumento.LEGAL,
    obligatorio: true,
  },
  {
    nombre: 'Documentos legales / poderes',
    categoria: CategoriaDocumento.LEGAL,
    obligatorio: true,
  },
  {
    nombre: 'Cámara de Comercio (vigencia < 90 días)',
    categoria: CategoriaDocumento.LEGAL,
    obligatorio: true,
  },
  {
    nombre: 'Acuerdo de confidencialidad (NDA)',
    categoria: CategoriaDocumento.LEGAL,
    obligatorio: true,
  },
  {
    nombre: 'Estados financieros (últimos 2 años)',
    categoria: CategoriaDocumento.FINANCIERO,
    obligatorio: true,
  },
  {
    nombre: 'Referencias comerciales por escrito',
    categoria: CategoriaDocumento.REFERENCIAS,
    obligatorio: true,
  },
  {
    nombre: 'Certificaciones de calidad (ISO 9001/14001/45001)',
    categoria: CategoriaDocumento.CERTIFICACIONES,
    obligatorio: true,
  },
  {
    nombre: 'Política SST / certificaciones ambientales',
    categoria: CategoriaDocumento.CERTIFICACIONES,
    obligatorio: true,
  },
  {
    nombre: 'Pólizas vigentes (RC / cumplimiento)',
    categoria: CategoriaDocumento.CERTIFICACIONES,
    obligatorio: true,
  },
  {
    nombre: 'Certificación SG-SST / RUC (HSE)',
    categoria: CategoriaDocumento.HSE,
    obligatorio: false,
  },
  {
    nombre: 'Política o reporte de sostenibilidad',
    categoria: CategoriaDocumento.SOSTENIBILIDAD,
    obligatorio: false,
  },
  {
    nombre: 'Reporte de centrales de riesgo',
    categoria: CategoriaDocumento.RIESGO_FINANCIERO,
    obligatorio: false,
  },
  {
    nombre: 'Formulario SARLAFT / conocimiento del proveedor',
    categoria: CategoriaDocumento.LAFT,
    obligatorio: false,
  },
];
