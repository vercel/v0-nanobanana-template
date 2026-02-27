import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Returns true if Supabase environment variables are configured.
 * Use this to gate features that require the database.
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Creates a Supabase admin client with service role key.
 * This bypasses RLS and should only be used for trusted server-side operations.
 * DO NOT expose this client to the client-side.
 *
 * Returns null when Supabase is not configured (e.g. fresh fork of the template).
 */
export function createAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
