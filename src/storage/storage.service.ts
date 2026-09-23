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

  /** Batch version for pages that show many files at once (galleries). Missing files map to null. */
  async createDownloadUrls(bucket: string, paths: string[], expiresInSeconds = 3600): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (paths.length === 0) return result;
    const { data, error } = await this.supabase.admin.storage.from(bucket).createSignedUrls(paths, expiresInSeconds);
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'No se pudieron generar los enlaces de los archivos.');
    }
    for (const item of data) {
      if (item.path) result.set(item.path, item.error ? null : item.signedUrl);
    }
    return result;
  }

  /** Best-effort delete — a leftover object is harmless, a failed DB delete is not. */
  async remove(bucket: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.supabase.admin.storage.from(bucket).remove(paths);
  }

  /** Creates a private bucket if it doesn't exist yet. Returns false when the bucket couldn't be checked or created. */
  async ensureBucket(bucket: string, options: { fileSizeLimit: number; allowedMimeTypes: string[] }): Promise<boolean> {
    const { data } = await this.supabase.admin.storage.getBucket(bucket);
    if (data) return true;
    const { error } = await this.supabase.admin.storage.createBucket(bucket, { public: false, ...options });
    return !error;
  }
}
