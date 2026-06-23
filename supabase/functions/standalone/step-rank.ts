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
  if (p.youtubeUrl) {
    finalUserPrompt += `

[URL do V\xEDdeo referenciado: ${p.youtubeUrl}]`;
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

// supabase/functions/step-rank/index.ts
var MIN_SCORE = 50;
Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  try {
    const { content_item_id } = await req.json();
    const db = adminClient();
    const { data: item, error } = await db.from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item n\xE3o encontrado" }, 404);
    const { data: region } = await db.from("regions").select("name").eq("id", item.region_id).single();
    await db.from("content_items").update({ status: "ranking" }).eq("id", content_item_id);
    const u = item.understanding ?? {};
    const { text } = await runStep(db, "rank", item, {
      region_name: region?.name ?? "",
      summary: u.summary ?? "",
      facts: u.facts ?? []
    });
    const parsed = parseJsonLoose(text);
    let pautasList = parsed.pautas;
    if (!pautasList || !Array.isArray(pautasList)) {
      if ("score" in parsed) {
        pautasList = [parsed];
      } else {
        pautasList = [];
      }
    }
    const validPautas = pautasList.filter((p) => {
      const s = Number(p.score ?? 0);
      return p.recommend !== false && s >= MIN_SCORE;
    });
    if (validPautas.length === 0) {
      const firstDiscarded = pautasList[0] ?? {};
      await db.from("content_items").update({
        rank_score: Number(firstDiscarded.score ?? 0),
        rank_rationale: firstDiscarded,
        status: "discarded"
      }).eq("id", content_item_id);
      return json({ ok: true, status: "discarded", count: 0 });
    }
    const firstPauta = validPautas[0];
    await db.from("content_items").update({
      rank_score: Number(firstPauta.score ?? 0),
      rank_rationale: firstPauta,
      status: "ranked"
    }).eq("id", content_item_id);
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
