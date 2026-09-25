import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 60_000;

/**
 * .docx → PDF through a Gotenberg service (LibreOffice in a container, see
 * deploy/contabo/docker-compose.yml). Without GOTENBERG_URL the filled Word
 * file is delivered as is.
 */
@Injectable()
export class PdfConversor {
  private readonly logger = new Logger(PdfConversor.name);
  private readonly url: string | null;

  constructor(config: ConfigService) {
    const u = config.get<string>('GOTENBERG_URL')?.trim();
    this.url = u ? u.replace(/\/+$/, '') : null;
  }

  get disponible() {
    return !!this.url;
  }

  /** Null when there is no converter or it failed (logged). */
  async aPdf(docx: Buffer, nombre = 'documento.docx'): Promise<Buffer | null> {
    if (!this.url) return null;
    try {
      const form = new FormData();
      form.append(
        'files',
        new Blob([new Uint8Array(docx)], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        nombre.endsWith('.docx') ? nombre : `${nombre}.docx`,
      );
      const res = await fetch(`${this.url}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(
          `Gotenberg respondió ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.logger.warn(
        `No se pudo convertir a PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
