// ETAPA 1 — Entendimento / transcrição.
// Recebe { content_item_id }. Lê o conteúdo bruto, manda o Gemini estruturar,
// grava transcript + understanding e avança status para "understood".

import { adminClient } from "../_shared/db.ts";
import { runStep } from "../_shared/runStep.ts";
import { parseJsonLoose } from "../_shared/gemini.ts";
import { json, handleOptions } from "../_shared/http.ts";
import type { ContentItem, Source } from "../_shared/types.ts";
import { fetchYoutubeTranscript } from "../_shared/youtubeTranscriptService.ts";

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
    let rawContent = [
      raw.text, raw.description, raw.caption, raw.transcript_hint, raw.body,
    ].filter(Boolean).join("\n\n") || JSON.stringify(raw);

    // Trunca textos muito longos (como PDFs de Diário Oficial) para caber no contexto seguro (~125k tokens)
    if (rawContent.length > 500000) {
      console.warn(`[step-understand] rawContent muito grande (${rawContent.length} chars), truncando para 500.000...`);
      rawContent = rawContent.substring(0, 500000) + "\n\n[...conteúdo truncado por limite de tamanho...]";
    }

    let nativeTranscript: string | null = null;
    const sourceType = (source as Source)?.type ?? "";

    if (sourceType === "youtube" && item.external_url) {
      // Extrai o ID do vídeo (ex: v=12345678901 ou youtu.be/12345678901)
      const match = item.external_url.match(/(?:v=|youtu\.be\/)([^&]+)/);
      if (match && match[1]) {
        const videoId = match[1];
        nativeTranscript = await fetchYoutubeTranscript(videoId);
        if (nativeTranscript) {
          // Trunca para análise rápida (economia de tokens)
          const excerpt = nativeTranscript.substring(0, 2500);
          rawContent = rawContent ? `${rawContent}\n\n[Transcrição]: ${excerpt}` : `[Transcrição]: ${excerpt}`;
        }
      }
    }

    const { text } = await runStep(db, "understand", item as ContentItem, {
      source_type: (source as Source)?.type ?? "",
      source_name: (source as Source)?.name ?? "",
      title: item.title ?? "",
      external_url: item.external_url ?? "",
      raw_content: rawContent,
    });

    const parsed = parseJsonLoose<{ transcript?: string }>(text);

    // Se temos a transcrição nativa, garantimos que ela não exceda o limite de ~40k antes de salvar
    let finalTranscript = parsed.transcript ?? null;
    if (nativeTranscript) {
      finalTranscript = nativeTranscript.length > 40000 
        ? nativeTranscript.substring(0, 40000) + "\n\n[...transcrição truncada por limite de tamanho...]"
        : nativeTranscript;
    }

    await db.from("content_items").update({
      transcript: finalTranscript,
      understanding: parsed,
      status: "understood",
    }).eq("id", content_item_id);

    return json({ ok: true, status: "understood" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
