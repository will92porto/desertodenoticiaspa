// ETAPA 1 — Entendimento / transcrição.
// Recebe { content_item_id }. Lê o conteúdo bruto, manda o Gemini estruturar,
// grava transcript + understanding e avança status para "understood".

import { adminClient } from "../_shared/db.ts";
import { runStep } from "../_shared/runStep.ts";
import { parseJsonLoose } from "../_shared/gemini.ts";
import { json, handleOptions } from "../_shared/http.ts";
import type { ContentItem, Source } from "../_shared/types.ts";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { content_item_id } = await req.json();
    const db = adminClient();

    const { data: item, error } = await db
      .from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);

    const { data: source } = await db
      .from("sources").select("*").eq("id", (item as ContentItem).source_id).single();

    await db.from("content_items").update({ status: "understanding" }).eq("id", content_item_id);

    // Monta o "conteúdo bruto" a partir do payload captado.
    const raw = item.raw_payload ?? {};
    const rawContent = [
      raw.text, raw.description, raw.caption, raw.transcript_hint, raw.body,
    ].filter(Boolean).join("\n\n") || JSON.stringify(raw);

    const { text } = await runStep(db, "understand", item as ContentItem, {
      source_type: (source as Source)?.type ?? "",
      source_name: (source as Source)?.name ?? "",
      title: item.title ?? "",
      external_url: item.external_url ?? "",
      raw_content: rawContent,
    });

    const parsed = parseJsonLoose<{ transcript?: string }>(text);

    await db.from("content_items").update({
      transcript: parsed.transcript ?? null,
      understanding: parsed,
      status: "understood",
    }).eq("id", content_item_id);

    return json({ ok: true, status: "understood" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
