// supabase/functions/_shared/db.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY s\xE3o obrigat\xF3rios.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// supabase/functions/_shared/http.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
function handleOptions(req) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

// supabase/functions/pipeline-orchestrator/index.ts
var NEXT = {
  captured: "step-understand",
  understood: "step-rank",
  ranked: "step-write",
  written: "step-polish"
};
var BATCH = 5;
async function invokeFunction(name, body) {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}
Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const db = adminClient();
    const statuses = Object.keys(NEXT);
    const { data: items, error } = await db.from("content_items").select("id, status").in("status", statuses).order("captured_at", { ascending: true }).limit(BATCH);
    if (error) throw error;
    const results = [];
    for (const it of items ?? []) {
      const fn = NEXT[it.status];
      if (!fn) continue;
      const r = await invokeFunction(fn, { content_item_id: it.id });
      results.push({ id: it.id, from: it.status, fn, ok: r.ok });
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
