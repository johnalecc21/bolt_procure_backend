export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

export interface ContenidoCorreo {
  titulo: string;
  cuerpo: string;
  /** Absolute URL of the screen where the recipient can act. */
  accionUrl?: string;
  accionTexto?: string;
  /** Absolute URL where the recipient can turn these emails off. */
  preferenciasUrl?: string;
}

/**
 * One simple, table-based layout that renders in Gmail/Outlook without
 * external CSS. All dynamic text is escaped.
 */
export function renderCorreo(c: ContenidoCorreo): {
  html: string;
  text: string;
} {
  const boton = c.accionUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(c.accionUrl)}" style="background:#0ea5e9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">${escapeHtml(c.accionTexto ?? 'Ver en Procurex')}</a></p>`
    : '';
  const pie = c.preferenciasUrl
    ? `<p style="font-size:12px;color:#64748b">Recibes este correo por tu actividad en Procurex. <a href="${escapeHtml(c.preferenciasUrl)}" style="color:#64748b">Dejar de recibir estos correos</a>.</p>`
    : '';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;padding:28px">
<tr><td>
<p style="font-weight:700;font-size:18px;margin:0 0 20px">Procure<span style="color:#0ea5e9">X</span></p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(c.titulo)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0">${escapeHtml(c.cuerpo)}</p>
${boton}
${pie}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    c.titulo,
    '',
    c.cuerpo,
    ...(c.accionUrl
      ? ['', `${c.accionTexto ?? 'Ver en Procurex'}: ${c.accionUrl}`]
      : []),
    ...(c.preferenciasUrl
      ? ['', `Dejar de recibir estos correos: ${c.preferenciasUrl}`]
      : []),
  ].join('\n');
  return { html, text };
}
