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

// supabase/functions/_shared/prompt.ts
async function resolveStepConfig(db, step, projectId) {
  const { data, error } = await db.from("step_configs").select("*").eq("step", step).eq("is_active", true).or(`project_id.eq.${projectId},project_id.is.null`);
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Nenhuma step_config ativa para a etapa "${step}".`);
  }
  const specific = data.find((c) => c.project_id === projectId);
  return specific ?? data[0];
}
function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === void 0 || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

// supabase/functions/_shared/gemini.ts
var OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
async function callGemini(p) {
  const apiKey = Deno.env.get("OPEN_KEY");
  if (!apiKey) throw new Error("OPEN_KEY n\xE3o configurada.");
  const modelsToTry = p.modelsToTry && p.modelsToTry.length > 0 ? p.modelsToTry : [
    "google/gemma-3-27b-it",
    "google/gemini-2.5-flash-lite"
  ];
  let finalUserPrompt = p.userPrompt;
  }
  const body = {
    models: modelsToTry,
    messages: [
      { role: "system", content: p.systemPrompt },
      { role: "user", content: finalUserPrompt }
    ],
    temperature: p.temperature ?? 0.7,
    max_tokens: p.maxOutputTokens ?? 4096
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
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText}`);
  }
  const json2 = await res.json();
  const text = json2?.choices?.[0]?.message?.content ?? "";
  return {
    text,
    tokensInput: json2?.usage?.prompt_tokens,
    tokensOutput: json2?.usage?.completion_tokens,
    raw: json2
  };
}
function parseJsonLoose(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return JSON.parse(t);
}

// supabase/functions/_shared/runStep.ts
async function runStep(db, step, item, vars) {
  const config = await resolveStepConfig(db, step, item.project_id);
  const userPrompt = renderTemplate(config.user_prompt_template, vars);
  const responseMimeType = config.extra?.response_mime_type || void 0;
  const start = Date.now();
  let outputText = "";
  let runStatus = "ok";
  let errorMessage = null;
  let tokensIn;
  let tokensOut;
  const { data: trainingData } = await db.from("business_training").select("*").or(`project_id.eq.${item.project_id},project_id.is.null`);
  let trainingContent = "";
  if (trainingData && trainingData.length > 0) {
    const specific = trainingData.find((t) => t.project_id === item.project_id);
    trainingContent = specific ? specific.content : trainingData[0].content;
  }
  let finalSystemPrompt = config.system_prompt;
  if (trainingContent) {
    finalSystemPrompt += "\n\n=== DIRETRIZES DE TREINAMENTO DO NEG\xD3CIO ===\n" + trainingContent;
  }
  const { data: aiModelsData } = await db.from("ai_models").select("model_id").eq("is_active", true).order("priority", { ascending: true });
  const modelsToTry = aiModelsData?.map((m) => m.model_id) || [];
  try {
    const res = await callGemini({
      model: config.model,
      modelsToTry,
      systemPrompt: finalSystemPrompt,
      userPrompt,
      temperature: config.temperature,
      maxOutputTokens: config.max_output_tokens,
      responseMimeType
    });
    outputText = res.text;
    tokensIn = res.tokensInput;
    tokensOut = res.tokensOutput;
  } catch (e) {
    runStatus = "error";
    errorMessage = e instanceof Error ? e.message : String(e);
  }
  await db.from("pipeline_runs").insert({
    content_item_id: item.id,
    step,
    step_config_id: config.id,
    provider: config.provider,
    model: config.model,
    prompt_sent: userPrompt,
    output_raw: outputText,
    tokens_input: tokensIn ?? null,
    tokens_output: tokensOut ?? null,
    duration_ms: Date.now() - start,
    status: runStatus,
    error_message: errorMessage
  });
  if (runStatus === "error") {
    throw new Error(`Etapa ${step} falhou: ${errorMessage}`);
  }
  return { text: outputText, config };
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

// supabase/functions/_shared/youtubeTranscriptService.ts
import { YoutubeTranscript } from "npm:youtube-transcript";
function decodeEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}
async function fetchYoutubeTranscript(videoId) {
  const db = adminClient();
  const cacheKey = `youtube_transcript_v1_${videoId}`;
  try {
    const { data: cacheHit } = await db.from("kv_cache").select("value, created_at").eq("key", cacheKey).single();
    if (cacheHit) {
      const createdAt = new Date(cacheHit.created_at);
      const now = /* @__PURE__ */ new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const diffDays = diffMs / (1e3 * 60 * 60 * 24);
      if (diffDays <= 7) {
        return cacheHit.value.transcript;
      }
    }
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "pt" }).catch(() => YoutubeTranscript.fetchTranscript(videoId));
    if (!segments || segments.length === 0) return null;
    const transcript = segments.map((s) => decodeEntities(s.text).trim()).filter(Boolean).join(" ");
    await db.from("kv_cache").upsert({
      key: cacheKey,
      value: { transcript },
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return transcript;
  } catch (error) {
    console.warn(`[youtube-transcript] Falha ao extrair v\xEDdeo ${videoId}:`, error);
    return null;
  }
}

// supabase/functions/step-understand/index.ts
Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const { content_item_id } = await req.json();
    const db = adminClient();
    const { data: item, error } = await db.from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item n\xE3o encontrado" }, 404);
    const { data: source } = await db.from("sources").select("*").eq("id", item.source_id).single();
    await db.from("content_items").update({ status: "understanding" }).eq("id", content_item_id);
    const raw = item.raw_payload ?? {};
    let rawContent = [
      raw.text,
      raw.description,
      raw.caption,
      raw.transcript_hint,
      raw.body
    ].filter(Boolean).join("\n\n") || JSON.stringify(raw);
    if (rawContent.length > 5e5) {
      console.warn(`[step-understand] rawContent muito grande (${rawContent.length} chars), truncando para 500.000...`);
      rawContent = rawContent.substring(0, 5e5) + "\n\n[...conte\xFAdo truncado por limite de tamanho...]";
    }
    let nativeTranscript = null;
    const sourceType = source?.type ?? "";
    const isYoutubeUrl = item.external_url && (item.external_url.includes("youtube.com") || item.external_url.includes("youtu.be"));
    if ((sourceType === "youtube" || isYoutubeUrl) && item.external_url) {
      const match = item.external_url.match(/(?:v=|youtu\.be\/)([^&]+)/);
      if (match && match[1]) {
        const videoId = match[1];
        nativeTranscript = await fetchYoutubeTranscript(videoId);
        if (nativeTranscript) {
          const excerpt = nativeTranscript.substring(0, 2500);
          rawContent = rawContent ? `${rawContent}

[Transcri\xE7\xE3o]: ${excerpt}` : `[Transcri\xE7\xE3o]: ${excerpt}`;
        }
      }
    }
    const { text } = await runStep(db, "understand", item, {
      source_type: source?.type ?? "",
      source_name: source?.name ?? "",
      title: item.title ?? "",
      external_url: item.external_url ?? "",
      raw_content: rawContent
    });
    const parsed = parseJsonLoose(text);
    let finalTranscript = parsed.transcript ?? null;
    if (nativeTranscript) {
      finalTranscript = nativeTranscript.length > 4e4 ? nativeTranscript.substring(0, 4e4) + "\n\n[...transcri\xE7\xE3o truncada por limite de tamanho...]" : nativeTranscript;
    }
    await db.from("content_items").update({
      transcript: finalTranscript,
      understanding: parsed,
      status: "understood"
    }).eq("id", content_item_id);
    return json({ ok: true, status: "understood" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
