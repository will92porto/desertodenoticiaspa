// ETAPA 3 — Escrita da matéria.
// Recebe { content_item_id }. Usa understanding + rank_rationale.
// Grava draft (Markdown). Avança para "written".

import { adminClient } from "../_shared/db.ts";
import { runStep } from "../_shared/runStep.ts";
import { json, handleOptions } from "../_shared/http.ts";
import type { ContentItem } from "../_shared/types.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { content_item_id } = await req.json();
    const db = adminClient();

    const { data: item, error } = await db
      .from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);

    const { data: region } = await db
      .from("regions").select("name").eq("id", (item as ContentItem).region_id).single();

    await db.from("content_items").update({ status: "writing" }).eq("id", content_item_id);

    const u = (item.understanding ?? {}) as Record<string, unknown>;
    const r = (item.rank_rationale ?? {}) as Record<string, unknown>;

    const { text } = await runStep(db, "write", item as ContentItem, {
      region_name: region?.name ?? "",
      suggested_headline: r.suggested_headline ?? "",
      discover_angle: r.discover_angle ?? "",
      summary: u.summary ?? "",
      facts: u.facts ?? [],
      transcript: item.transcript ?? "",
    });

    await db.from("content_items").update({
      draft: text,
      status: "written",
    }).eq("id", content_item_id);

    return json({ ok: true, status: "written" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
