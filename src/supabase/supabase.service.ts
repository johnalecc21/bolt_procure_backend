import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  /** Validates user-issued tokens (auth.getUser). Uses the anon key — safe, no elevated privileges. */
  readonly anon: SupabaseClient;
  /** Admin operations (create/invite/delete users). Uses the service_role key — never exposed to clients. */
  readonly admin: SupabaseClient;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    this.anon = createClient(url, config.getOrThrow<string>('SUPABASE_ANON_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.admin = createClient(url, config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
}
