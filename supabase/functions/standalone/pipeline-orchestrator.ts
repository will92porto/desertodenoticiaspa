// ============================================================================
// ORQUESTRADOR  (ARQUIVO ÚNICO para o editor web)
// Cole TODO este conteúdo no editor da função "pipeline-orchestrator".
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

const NEXT: Record<string, string> = {
  captured: "step-understand", understood: "step-rank", ranked: "step-write", written: "step-polish",
};
const BATCH = 5;

async function invokeFunction(name: string, body: unknown) {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = adminClient();
    const statuses = Object.keys(NEXT);
    const { data: items, error } = await db.from("content_items").select("id, status").in("status", statuses).order("captured_at", { ascending: true }).limit(BATCH);
    if (error) throw error;
    const results: unknown[] = [];
    for (const it of items ?? []) {
      const fn = NEXT[it.status as string];
      if (!fn) continue;
      const r = await invokeFunction(fn, { content_item_id: it.id });
      results.push({ id: it.id, from: it.status, fn, ok: r.ok });
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
