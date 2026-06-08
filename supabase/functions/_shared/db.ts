// Cliente Supabase com service role (bypassa RLS) para uso dentro das Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseAdmin = ReturnType<typeof adminClient>;
