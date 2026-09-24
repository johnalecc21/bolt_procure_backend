/**
 * CORS_ORIGIN may list several frontends separated by commas (e.g. the custom
 * domain and the *.vercel.app one). The first is the canonical public URL.
 */
export function origenesPermitidos(valor: string | undefined): string[] {
  const lista = (valor ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return lista.length ? lista : ['http://localhost:5173'];
}

/** Public URL of the frontend for links in emails and invitations. */
export function urlFrontend(
  appUrl: string | undefined,
  corsOrigin: string | undefined,
): string {
  return (appUrl?.trim() || origenesPermitidos(corsOrigin)[0]).replace(
    /\/+$/,
    '',
  );
}
