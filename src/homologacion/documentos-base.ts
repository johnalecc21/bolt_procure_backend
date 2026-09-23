import { CategoriaDocumento } from '@prisma/client';

/**
 * Documents every new homologación starts with. The first four block
 * "enviar" until uploaded; the rest are optional for the proveedor but a
 * client company can require their category before inviting (see
 * Company.categoriasHomologacionRequeridas).
 */
export const DOCUMENTOS_BASE: {
  nombre: string;
  categoria: CategoriaDocumento;
  obligatorio: boolean;
}[] = [
  {
    nombre: 'RUT / NIT',
    categoria: CategoriaDocumento.LEGAL,
    obligatorio: true,
  },
  {
    nombre: 'Estados financieros',
    categoria: CategoriaDocumento.FINANCIERO,
    obligatorio: true,
  },
  {
    nombre: 'Certificado ISO / BASC / ESG',
    categoria: CategoriaDocumento.CERTIFICACIONES,
    obligatorio: true,
  },
  {
    nombre: 'Referencias comerciales',
    categoria: CategoriaDocumento.REFERENCIAS,
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
