import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContenidoCorreo, renderCorreo } from './plantilla';
import { urlFrontend } from '../config/origenes';

const RESEND_URL = 'https://api.resend.com/emails';
const REINTENTOS = 3;

/**
 * Transactional email through Resend's HTTP API (no SDK needed). Without
 * RESEND_API_KEY it only logs — local development and tests never send.
 * Sending is fire-and-forget: a failed email must never fail the business
 * action that triggered it, so errors are retried and then logged.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string;
  readonly appUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('RESEND_API_KEY') || undefined;
    this.from =
      config.get<string>('EMAIL_FROM') ??
      'Procurex <notificaciones@procurex.co>';
    this.appUrl = urlFrontend(
      config.get<string>('APP_URL'),
      config.get<string>('CORS_ORIGIN'),
    );
  }

  get habilitado(): boolean {
    return !!this.apiKey;
  }

  /** Builds an absolute link from a portal-relative path like "/cliente/aprobaciones". */
  url(path: string): string {
    return `${this.appUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  enviar(to: string, asunto: string, contenido: ContenidoCorreo): void {
    void this.enviarAhora(to, asunto, contenido);
  }

  async enviarAhora(
    to: string,
    asunto: string,
    contenido: ContenidoCorreo,
  ): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.debug(`[correo deshabilitado] → ${to}: ${asunto}`);
      return false;
    }
    const { html, text } = renderCorreo(contenido);
    for (let intento = 1; intento <= REINTENTOS; intento++) {
      try {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: this.from,
            to: [to],
            subject: asunto,
            html,
            text,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return true;
        // 4xx other than rate limiting won't get better by retrying.
        if (res.status < 500 && res.status !== 429) {
          this.logger.warn(
            `Correo rechazado (${res.status}) → ${to}: ${await res.text()}`,
          );
          return false;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (intento === REINTENTOS) {
          this.logger.error(
            `No se pudo enviar el correo a ${to} tras ${REINTENTOS} intentos: ${(err as Error).message}`,
          );
          return false;
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** intento));
      }
    }
    return false;
  }
}
