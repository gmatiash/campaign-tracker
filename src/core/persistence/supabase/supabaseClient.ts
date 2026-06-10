// src/core/persistence/supabase/supabaseClient.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// New-style publishable key (sb_publishable_...). Falls back to the legacy anon key.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when URL + a browser key are present; otherwise the app runs local-only. */
export const isSupabaseConfigured = Boolean(url && key);

/** Single shared client, or null when not configured. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
