import {
  CategoriaDocumento,
  EstadoDocumento,
  EstadoHomologacion,
} from '@prisma/client';

interface HomologacionConDocs {
  estado: EstadoHomologacion;
  documentos: {
    categoria: CategoriaDocumento;
    estado: EstadoDocumento;
    vigencia: Date | null;
  }[];
}

/**
 * Categories from `requeridas` the proveedor doesn't currently meet: no
 * document of that category is VALIDADO and unexpired. Empty = eligible
 * (as far as documents go — the homologación itself must also be APROBADO).
 */
export function categoriasFaltantes(
  homologacion: HomologacionConDocs | null | undefined,
  requeridas: CategoriaDocumento[],
  ahora = new Date(),
): CategoriaDocumento[] {
  return requeridas.filter(
    (categoria) =>
      !homologacion?.documentos.some(
        (d) =>
          d.categoria === categoria &&
          d.estado === EstadoDocumento.VALIDADO &&
          (!d.vigencia || d.vigencia > ahora),
      ),
  );
}

export function esElegible(
  homologacion: HomologacionConDocs | null | undefined,
  requeridas: CategoriaDocumento[],
  ahora = new Date(),
): boolean {
  return (
    homologacion?.estado === EstadoHomologacion.APROBADO &&
    categoriasFaltantes(homologacion, requeridas, ahora).length === 0
  );
}
