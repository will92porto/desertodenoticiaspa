// ETAPA 4 — Polimento editorial + SEO.
// Recebe { content_item_id }. Usa o draft da etapa 3.
// Grava final_article + seo. Avança para "ready" (pronto para publicar).

import { adminClient } from "../_shared/db.ts";
import { runStep } from "../_shared/runStep.ts";
import { parseJsonLoose } from "../_shared/gemini.ts";
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

    await db.from("content_items").update({ status: "polishing" }).eq("id", content_item_id);

    const r = (item.rank_rationale ?? {}) as Record<string, unknown>;
    const { text } = await runStep(db, "polish", item as ContentItem, {
      region_name: region?.name ?? "",
      search_keywords: r.search_keywords ?? [],
      draft: item.draft ?? "",
    });

    const parsed = parseJsonLoose<{ article_markdown?: string; seo?: unknown }>(text);

    await db.from("content_items").update({
      final_article: parsed.article_markdown ?? item.draft,
      seo: parsed.seo ?? null,
      status: "ready",
    }).eq("id", content_item_id);

    return json({ ok: true, status: "ready" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
