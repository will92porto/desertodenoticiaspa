// ============================================================================
// ETAPA 2 — Ranking de pautas  (ARQUIVO ÚNICO para o editor web)
// Cole TODO este conteúdo no editor da função "step-rank" no Dashboard.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
async function callGemini(p: { model: string; systemPrompt: string; userPrompt: string; temperature?: number; maxOutputTokens?: number; responseMimeType?: string; }) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");
  const body = {
    systemInstruction: { parts: [{ text: p.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: p.userPrompt }] }],
    generationConfig: { temperature: p.temperature ?? 0.7, maxOutputTokens: p.maxOutputTokens ?? 4096, ...(p.responseMimeType ? { responseMimeType: p.responseMimeType } : {}) },
  };
  const res = await fetch(`${GEMINI_BASE}/${p.model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text: string = j?.candidates?.[0]?.content?.parts?.map((x: any) => x.text ?? "").join("") ?? "";
  return { text, tokensInput: j?.usageMetadata?.promptTokenCount, tokensOutput: j?.usageMetadata?.candidatesTokenCount };
}
function parseJsonLoose<T = any>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(t) as T;
}
async function resolveStepConfig(db: any, step: string, projectId: string) {
  const { data, error } = await db.from("step_configs").select("*").eq("step", step).eq("is_active", true).or(`project_id.eq.${projectId},project_id.is.null`);
  if (error) throw error;
  if (!data?.length) throw new Error(`Nenhuma step_config ativa para "${step}".`);
  return data.find((c: any) => c.project_id === projectId) ?? data[0];
}
function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => { const v = vars[k]; if (v === undefined || v === null) return ""; return typeof v === "string" ? v : JSON.stringify(v); });
}
async function runStep(db: any, step: string, item: any, vars: Record<string, unknown>) {
  const config = await resolveStepConfig(db, step, item.project_id);
  const userPrompt = renderTemplate(config.user_prompt_template, vars);
  const responseMimeType = config.extra?.response_mime_type || undefined;
  const start = Date.now();
  let outputText = "", runStatus = "ok", errorMessage: string | null = null, tokensIn, tokensOut;
  try {
    const res = await callGemini({ model: config.model, systemPrompt: config.system_prompt, userPrompt, temperature: config.temperature, maxOutputTokens: config.max_output_tokens, responseMimeType });
    outputText = res.text; tokensIn = res.tokensInput; tokensOut = res.tokensOutput;
  } catch (e) { runStatus = "error"; errorMessage = e instanceof Error ? e.message : String(e); }
  await db.from("pipeline_runs").insert({ content_item_id: item.id, step, step_config_id: config.id, provider: config.provider, model: config.model, prompt_sent: userPrompt, output_raw: outputText, tokens_input: tokensIn ?? null, tokens_output: tokensOut ?? null, duration_ms: Date.now() - start, status: runStatus, error_message: errorMessage });
  if (runStatus === "error") throw new Error(`Etapa ${step} falhou: ${errorMessage}`);
  return { text: outputText, config };
}

// Pautas abaixo desta nota são descartadas.
const MIN_SCORE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { content_item_id } = await req.json();
    const db = adminClient();
    const { data: item, error } = await db.from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);
    const { data: region } = await db.from("regions").select("name").eq("id", item.region_id).single();

    await db.from("content_items").update({ status: "ranking" }).eq("id", content_item_id);

    const u = item.understanding ?? {};
    const { text } = await runStep(db, "rank", item, { region_name: region?.name ?? "", summary: u.summary ?? "", facts: u.facts ?? [] });
    const parsed = parseJsonLoose<{ score?: number; recommend?: boolean }>(text);
    const score = Number(parsed.score ?? 0);
    const keep = parsed.recommend !== false && score >= MIN_SCORE;

    await db.from("content_items").update({ rank_score: score, rank_rationale: parsed, status: keep ? "ranked" : "discarded" }).eq("id", content_item_id);
    return json({ ok: true, score, status: keep ? "ranked" : "discarded" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
