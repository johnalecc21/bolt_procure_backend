import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createWorker, Worker } from 'tesseract.js';
import { PDFParse } from 'pdf-parse';

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
};

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  // Spinning up a Tesseract worker is the expensive part, not recognizing a
  // single image — reuse one lazily-created worker across every call instead
  // of paying that startup cost per document. Concurrent recognize() calls
  // on the same worker queue internally rather than corrupting each other,
  // so this is safe to share across a Promise.all of documents.
  private worker: Promise<Worker> | null = null;

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = createWorker('spa+eng');
    }
    return this.worker;
  }

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
        const worker = await this.getWorker();
        const {
          data: { text },
        } = await worker.recognize(buffer);
        return text.trim();
      }
      return '';
    } catch (err) {
      this.logger.warn(`No se pudo extraer texto de ${filename}: ${(err as Error).message}`);
      return '';
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      const worker = await this.worker;
      await worker.terminate();
    }
  }
}
