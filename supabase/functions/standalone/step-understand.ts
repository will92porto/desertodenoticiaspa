// ============================================================================
// ETAPA 1 — Entendimento / transcrição  (ARQUIVO ÚNICO para o editor web)
// Cole TODO este conteúdo no editor da função "step-understand" no Dashboard.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- helpers HTTP/CORS ----
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---- cliente admin ----
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ---- OpenRouter (substitui Gemini antigo) ----
const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
async function callGemini(p: {
  model: string; systemPrompt: string; userPrompt: string;
  temperature?: number; maxOutputTokens?: number; responseMimeType?: string;
  youtubeUrl?: string;
}) {
  const apiKey = Deno.env.get("OPEN_KEY");
  if (!apiKey) throw new Error("OPEN_KEY não configurada.");

  const modelsToTry = [
    "google/gemma-3-27b-it",
    "google/gemini-2.5-flash-lite-preview"
  ];

  let finalUserPrompt = p.userPrompt;
  if (p.youtubeUrl) {
    finalUserPrompt += `\n\n[URL do Vídeo referenciado: ${p.youtubeUrl}]`;
  }

  const body: any = {
    models: modelsToTry,
    messages: [
      { role: "system", content: p.systemPrompt },
      { role: "user", content: finalUserPrompt }
    ],
    temperature: p.temperature ?? 0.7,
    max_tokens: p.maxOutputTokens ?? 4096,
  };

  if (p.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_BASE, {
    method: "POST", 
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://desertodenoticias.com",
      "X-Title": "Deserto de Noticias"
    }, 
    body: JSON.stringify(body),
  });
  
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  
  return { text, tokensInput: j?.usage?.prompt_tokens, tokensOutput: j?.usage?.completion_tokens };
}
function parseJsonLoose<T = any>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(t) as T;
}

// ---- resolução de config + template ----
async function resolveStepConfig(db: any, step: string, projectId: string) {
  const { data, error } = await db.from("step_configs").select("*")
    .eq("step", step).eq("is_active", true)
    .or(`project_id.eq.${projectId},project_id.is.null`);
  if (error) throw error;
  if (!data?.length) throw new Error(`Nenhuma step_config ativa para "${step}".`);
  return data.find((c: any) => c.project_id === projectId) ?? data[0];
}
function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

// ---- executa a etapa (config -> prompt -> Gemini -> log) ----
async function runStep(db: any, step: string, item: any, vars: Record<string, unknown>, youtubeUrl?: string) {
  const config = await resolveStepConfig(db, step, item.project_id);
  // Injeta a DATA ATUAL para o modelo não rejeitar eventos por achar que está
  // num ano anterior (o conhecimento do modelo tem corte temporal).
  const hoje = new Date().toISOString().slice(0, 10);
  const varsComData = { ...vars, data_atual: hoje };
  const userPrompt = renderTemplate(config.user_prompt_template, varsComData);
  const systemPrompt =
    `CONTEXTO TEMPORAL: a data de hoje é ${hoje}. Trate esta data como verdade ` +
    `absoluta; NÃO use seu conhecimento de treinamento para julgar se um ano é ` +
    `passado ou futuro. Eventos com data até hoje são fatos já ocorridos e podem ` +
    `ser noticiados normalmente.\n\n` + config.system_prompt;
  const responseMimeType = config.extra?.response_mime_type || undefined;
  const start = Date.now();
  let outputText = "", runStatus = "ok", errorMessage: string | null = null;
  let tokensIn, tokensOut;
  try {
    const res = await callGemini({
      model: config.model, systemPrompt, userPrompt,
      temperature: config.temperature,
      // Transcrição de vídeo pode ser longa: garante teto alto quando há vídeo.
      maxOutputTokens: youtubeUrl ? Math.max(config.max_output_tokens, 8192) : config.max_output_tokens,
      responseMimeType, youtubeUrl,
    });
    outputText = res.text; tokensIn = res.tokensInput; tokensOut = res.tokensOutput;
  } catch (e) {
    runStatus = "error"; errorMessage = e instanceof Error ? e.message : String(e);
  }
  await db.from("pipeline_runs").insert({
    content_item_id: item.id, step, step_config_id: config.id,
    provider: config.provider, model: config.model, prompt_sent: userPrompt,
    output_raw: outputText, tokens_input: tokensIn ?? null, tokens_output: tokensOut ?? null,
    duration_ms: Date.now() - start, status: runStatus, error_message: errorMessage,
  });
  if (runStatus === "error") throw new Error(`Etapa ${step} falhou: ${errorMessage}`);
  return { text: outputText, config };
}

// ---- handler ----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { content_item_id } = await req.json();
    const db = adminClient();
    const { data: item, error } = await db.from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);
    const { data: source } = await db.from("sources").select("*").eq("id", item.source_id).single();

    await db.from("content_items").update({ status: "understanding" }).eq("id", content_item_id);

    const raw = item.raw_payload ?? {};
    const rawContent = [raw.text, raw.description, raw.caption, raw.transcript_hint, raw.body]
      .filter(Boolean).join("\n\n") || JSON.stringify(raw);

    // Se a fonte for YouTube, envia a URL do vídeo para o Gemini transcrever o
    // áudio de verdade (processamento no lado do Google, sem baixar o arquivo).
    const ytUrl = source?.type === "youtube"
      ? (item.external_url || raw.link as string | undefined)
      : undefined;

    const { text } = await runStep(db, "understand", item, {
      source_type: source?.type ?? "", source_name: source?.name ?? "",
      title: item.title ?? "", external_url: item.external_url ?? "", raw_content: rawContent,
    }, ytUrl);
    const parsed = parseJsonLoose<{ transcript?: string }>(text);

    await db.from("content_items").update({
      transcript: parsed.transcript ?? null, understanding: parsed, status: "understood",
    }).eq("id", content_item_id);

    return json({ ok: true, status: "understood" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
