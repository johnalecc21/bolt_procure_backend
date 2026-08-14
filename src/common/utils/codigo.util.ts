/** Matches the REQ-0001 format the frontend derives from `numero` — keep them in sync. */
export function formatRequerimientoCodigo(numero: number): string {
  return `REQ-${numero.toString().padStart(4, '0')}`;
}
