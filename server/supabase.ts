import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const PHOTOS_BUCKET_NAME = 'human bingo photos';

let cachedClient: SupabaseClient | null = null;

export function isSupabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SECRET_KEY?.trim());
}

export function getSupabaseAdminClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  if (cachedClient) return cachedClient;

  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Supabase server configuration missing: SUPABASE_URL and SUPABASE_SECRET_KEY must be set.',
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}
