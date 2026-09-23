import { CategoriaDocumento } from '@prisma/client';

/**
 * The checklist of documents every proveedor must upload during homologación,
 * aligned with sección 7 ("Documentos requeridos") of the Cuestionario de
 * Homologación de Proveedores. Seeded on the Homologacion at creation time —
 * used by BOTH the self-registration path (AuthService) and the externally-
 * added path (ProveedoresService), so it lives here to stay a single source
 * of truth instead of drifting between the two.
 */
export const DOCUMENTOS_HOMOLOGACION_INICIALES: { nombre: string; categoria: CategoriaDocumento }[] = [
  { nombre: 'RUT / NIT actualizado', categoria: CategoriaDocumento.LEGAL },
  { nombre: 'Documentos legales / poderes', categoria: CategoriaDocumento.LEGAL },
  { nombre: 'Cámara de Comercio (vigencia < 90 días)', categoria: CategoriaDocumento.LEGAL },
  { nombre: 'Acuerdo de confidencialidad (NDA)', categoria: CategoriaDocumento.LEGAL },
  { nombre: 'Estados financieros (últimos 2 años)', categoria: CategoriaDocumento.FINANCIERO },
  { nombre: 'Referencias comerciales por escrito', categoria: CategoriaDocumento.REFERENCIAS },
  { nombre: 'Certificaciones de calidad (ISO 9001/14001/45001)', categoria: CategoriaDocumento.CERTIFICACIONES },
  { nombre: 'Política SST / certificaciones ambientales', categoria: CategoriaDocumento.CERTIFICACIONES },
  { nombre: 'Pólizas vigentes (RC / cumplimiento)', categoria: CategoriaDocumento.CERTIFICACIONES },
];
