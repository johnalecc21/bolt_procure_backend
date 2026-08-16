import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Thin wrapper around Supabase Storage's signed-URL flow — was independently
 * copy-pasted (sanitize filename, createSignedUploadUrl, error handling; same
 * again for createSignedUrl) into homologacion, contratos and requerimientos.
 * Callers still build their own path (the scoping differs per domain) and
 * still validate ownership before calling this — this only owns the actual
 * Supabase call and its error handling.
 */
@Injectable()
export class StorageService {
  constructor(private supabase: SupabaseService) {}

  safeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }

  async createUploadUrl(bucket: string, path: string) {
    const { data, error } = await this.supabase.admin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo preparar la subida del archivo.');
    }
    return { path, token: data.token, signedUrl: data.signedUrl };
  }

  async createDownloadUrl(bucket: string, path: string, expiresInSeconds = 300) {
    const { data, error } = await this.supabase.admin.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudo generar el enlace de descarga.');
    }
    return { url: data.signedUrl };
  }
}
