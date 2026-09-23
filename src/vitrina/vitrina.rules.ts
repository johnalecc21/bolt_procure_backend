import { TipoArchivoVitrina } from '@prisma/client';

export const VITRINA_BUCKET = 'vitrina-proveedores';
export const MAX_BYTES_ARCHIVO = 10 * 1024 * 1024;

/** What a showcase upload is for — ITEM is a catalog item's photo. */
export type UsoArchivo = TipoArchivoVitrina | 'ITEM';

const EXT_IMAGEN = ['jpg', 'jpeg', 'png', 'webp'];
const EXT_DOCUMENTO = ['pdf'];

export const EXTENSIONES_POR_USO: Record<UsoArchivo, string[]> = {
  IMAGEN: EXT_IMAGEN,
  ITEM: EXT_IMAGEN,
  BROCHURE: EXT_DOCUMENTO,
  CATALOGO: EXT_DOCUMENTO,
};

/** Keeps a vitrina reasonable to load and review. */
export const LIMITES: Record<TipoArchivoVitrina, number> & { ITEMS: number } = {
  IMAGEN: 20,
  BROCHURE: 5,
  CATALOGO: 5,
  ITEMS: 60,
};

export function extension(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

export function extensionPermitida(uso: UsoArchivo, filename: string): boolean {
  return EXTENSIONES_POR_USO[uso].includes(extension(filename));
}

/** Storage folder per use, under the proveedor's own prefix. */
export function carpeta(proveedorId: string, uso: UsoArchivo): string {
  return `${proveedorId}/${uso.toLowerCase()}/`;
}

/** Only http(s) links are shown publicly — never javascript: or data: URLs. */
export function urlSegura(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
