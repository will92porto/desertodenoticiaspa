// ETAPA 2 — Ranking de pautas (potencial Google Discover / Pesquisa).
// Recebe { content_item_id }. Usa a understanding da etapa 1.
// Grava rank_score + rank_rationale. Avança para "ranked" ou "discarded".

import { adminClient } from "../_shared/db.ts";
import { runStep } from "../_shared/runStep.ts";
import { parseJsonLoose } from "../_shared/gemini.ts";
import { json, handleOptions } from "../_shared/http.ts";
import type { ContentItem } from "../_shared/types.ts";

// Pautas abaixo desta nota são descartadas automaticamente.
const MIN_SCORE = 50;

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

    await db.from("content_items").update({ status: "ranking" }).eq("id", content_item_id);

    const u = (item.understanding ?? {}) as Record<string, unknown>;
    const { text } = await runStep(db, "rank", item as ContentItem, {
      region_name: region?.name ?? "",
      summary: u.summary ?? "",
      facts: u.facts ?? [],
    });

    const parsed = parseJsonLoose<{ score?: number; recommend?: boolean }>(text);
    const score = Number(parsed.score ?? 0);
    const keep = parsed.recommend !== false && score >= MIN_SCORE;

    await db.from("content_items").update({
      rank_score: score,
      rank_rationale: parsed,
      status: keep ? "ranked" : "discarded",
    }).eq("id", content_item_id);

    return json({ ok: true, score, status: keep ? "ranked" : "discarded" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
