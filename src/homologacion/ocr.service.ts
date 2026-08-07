import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { PDFParse } from 'pdf-parse';

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
};

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /** Extracts whatever text it can find in the document. Returns '' if the format is unreadable. */
  async extractText(buffer: Buffer, filename: string): Promise<string> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    try {
      if (ext === 'pdf') {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          // pdf-parse inserts a "-- N of M --" separator per page even when the page has no real content.
          return result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();
        } finally {
          await parser.destroy();
        }
      }
      if (ext in IMAGE_MIME_BY_EXT) {
        const worker = await createWorker('spa+eng');
        try {
          const {
            data: { text },
          } = await worker.recognize(buffer);
          return text.trim();
        } finally {
          await worker.terminate();
        }
      }
      return '';
    } catch (err) {
      this.logger.warn(`No se pudo extraer texto de ${filename}: ${(err as Error).message}`);
      return '';
    }
  }
}
