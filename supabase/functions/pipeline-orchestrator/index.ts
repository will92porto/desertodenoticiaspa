// ORQUESTRADOR — avança os itens pelo pipeline.
// Acionado por cron (a cada poucos minutos) ou manualmente pelo admin.
// Para cada item num status "pronto para a próxima etapa", invoca a function
// correspondente. Mapa de status -> etapa:
//   captured   -> step-understand
//   understood -> step-rank
//   ranked     -> step-write
//   written    -> step-polish
//   ready      -> publish-wordpress
// (published/discarded/error não avançam automaticamente.)

import { adminClient } from "../_shared/db.ts";
import { json, handleOptions } from "../_shared/http.ts";

const NEXT: Record<string, string> = {
  captured: "step-understand",
  understood: "step-rank",
  ranked: "step-write",
  written: "step-polish",
  ready: "publish-wordpress",
};

// Quantos itens processar por invocação (evita timeout da function).
const BATCH = 2;

async function invokeFunction(name: string, body: unknown) {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const db = adminClient();
    const statuses = Object.keys(NEXT);

    const body = await req.json().catch(() => ({}));
    const specificIds = Array.isArray(body.ids) ? body.ids : null;

    let query = db
      .from("content_items")
      .select("id, status")
      .in("status", statuses)
      .order("captured_at", { ascending: true });

    if (specificIds && specificIds.length > 0) {
      query = query.in("id", specificIds);
    } else {
      query = query.limit(BATCH);
    }

    const { data: items, error } = await query;
    if (error) throw error;

    const results: unknown[] = [];
    for (const it of items ?? []) {
      let currentStatus = it.status as string;
      while (true) {
        const fn = NEXT[currentStatus];
        if (!fn) break;
        
        const r = await invokeFunction(fn, { content_item_id: it.id });
        results.push({ id: it.id, from: currentStatus, fn, ok: r.ok });
        
        if (!r.ok) break;

        // Verifica o novo status para continuar o loop
        const { data: updatedItem } = await db.from("content_items").select("status").eq("id", it.id).single();
        if (!updatedItem || updatedItem.status === currentStatus) break;
        
        currentStatus = updatedItem.status;
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
