import type { TipoContrato } from '@prisma/client';

/** Matches the REQ-0001 format the frontend derives from `numero` — keep them in sync. */
export function formatRequerimientoCodigo(numero: number): string {
  return `REQ-${numero.toString().padStart(4, '0')}`;
}

const CONTRATO_PREFIX: Record<TipoContrato, string> = {
  CONTRATO: 'CTO',
  PO: 'PO',
  ADDENDUM: 'ADD',
};

/** Matches the frontend's formatContratoCodigo — keep them in sync. */
export function formatContratoCodigo(tipo: TipoContrato, numero: number): string {
  return `${CONTRATO_PREFIX[tipo]}-${numero.toString().padStart(4, '0')}`;
}
