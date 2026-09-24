/** Kept in sync with the frontend's lib/analitica — the saved-chart builder only accepts these. */
export const METRICAS = [
  'gasto',
  'contratos',
  'ahorro',
  'ahorroPct',
  'procesosCreados',
  'procesosAdjudicados',
  'cicloDias',
  'ofertasPromedio',
  'ahorroNegociacion',
  'pagosPendientes',
] as const;

export const DIMENSIONES = [
  'mes',
  'trimestre',
  'categoria',
  'proveedor',
  'centroCosto',
  'unidad',
  'prioridad',
  'solicitante',
] as const;

export const TIPOS_GRAFICA = [
  'barras',
  'barrasHorizontales',
  'lineas',
  'area',
] as const;

/** Rows beyond this are cut (newest first) and the response says so. */
export const MAX_FILAS = 5000;
/** Widest window the dashboard can request (plus the same length before it for comparison). */
export const MAX_DIAS_PERIODO = 3 * 366;
export const MAX_GRAFICAS_POR_USUARIO = 20;
