// INGEST — varre fontes ativas, detecta novidades e cria content_items.
// Acionado por cron. Respeita check_interval_minutes por fonte.

import { adminClient } from "../_shared/db.ts";
import { json, handleOptions } from "../_shared/http.ts";
import { fetchNewItems } from "../_shared/adapters.ts";
import type { Source } from "../_shared/types.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const db = adminClient();
    const now = Date.now();

    const { data: sources, error } = await db
      .from("sources").select("*").eq("is_active", true);
    if (error) throw error;

    const report: unknown[] = [];

    for (const s of (sources ?? []) as Source[]) {
      // Respeita o intervalo de verificação.
      if (s.last_checked_at) {
        const due = new Date(s.last_checked_at).getTime() + s.check_interval_minutes * 60_000;
        if (now < due) continue;
      }

      // Precisamos do region_id e project_id para criar os itens.
      const { data: region } = await db
        .from("regions").select("id, project_id").eq("id", s.region_id).single();
      if (!region) continue;

      let created = 0;
      let errMsg: string | null = null;
      let newMarker = s.last_seen_marker;

      try {
        const result = await fetchNewItems(s);
        newMarker = result.newMarker;
        for (const it of result.items) {
          const { error: insErr } = await db.from("content_items").insert({
            source_id: s.id,
            region_id: region.id,
            project_id: region.project_id,
            external_id: it.external_id,
            external_url: it.external_url,
            title: it.title,
            raw_payload: it.raw_payload,
            status: "captured",
          });
          // Conflito de unique (source_id, external_id) = já existe, ignora.
          if (!insErr) created++;
        }
      } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
      }

      await db.from("sources").update({
        last_checked_at: new Date().toISOString(),
        last_seen_marker: newMarker,
      }).eq("id", s.id);

      report.push({ source: s.name, type: s.type, created, error: errMsg });
    }

    return json({ ok: true, checked: report.length, report });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
