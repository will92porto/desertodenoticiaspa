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

    const parsed = parseJsonLoose<{ pautas?: Array<{ score?: number; recommend?: boolean }> }>(text);
    
    // Backward compatibility: if the model returns the old format (single object)
    let pautasList = parsed.pautas;
    if (!pautasList || !Array.isArray(pautasList)) {
      if ('score' in parsed) {
        pautasList = [parsed as any];
      } else {
        pautasList = [];
      }
    }

    const validPautas = pautasList.filter(p => {
      const s = Number(p.score ?? 0);
      return p.recommend !== false && s >= MIN_SCORE;
    });

    if (validPautas.length === 0) {
      const firstDiscarded = pautasList[0] ?? {};
      await db.from("content_items").update({
        rank_score: Number(firstDiscarded.score ?? 0),
        rank_rationale: firstDiscarded,
        status: "discarded",
      }).eq("id", content_item_id);
      return json({ ok: true, status: "discarded", count: 0 });
    }

    // A primeira pauta atualiza o item original
    const firstPauta = validPautas[0];
    await db.from("content_items").update({
      rank_score: Number(firstPauta.score ?? 0),
      rank_rationale: firstPauta,
      status: "ranked",
    }).eq("id", content_item_id);

    // As demais pautas viram novos content_items
    for (let i = 1; i < validPautas.length; i++) {
      const pauta = validPautas[i];
      const newExternalId = `${item.external_id}#pauta-${i}`;
      
      await db.from("content_items").insert({
        source_id: item.source_id,
        region_id: item.region_id,
        project_id: item.project_id,
        external_id: newExternalId,
        external_url: item.external_url,
        title: item.title,
        raw_payload: item.raw_payload,
        transcript: item.transcript,
        understanding: item.understanding,
        rank_score: Number(pauta.score ?? 0),
        rank_rationale: pauta,
        status: "ranked"
      });
    }

    return json({ ok: true, status: "ranked", count: validPautas.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
