import { createClient } from "@supabase/supabase-js";

// Cliente para uso no servidor (Server Components / Route Handlers).
// Usa a service role key — NUNCA exponha no client.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Variáveis ausentes na Vercel: " +
        [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"]
          .filter(Boolean).join(", "),
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// URL base das Edge Functions.
export function functionsUrl() {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
}

export async function invokeFunction(fn: string, body: unknown) {
  const res = await fetch(`${functionsUrl()}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return res.json();
}
