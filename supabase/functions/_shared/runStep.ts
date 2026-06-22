// Executa uma etapa do pipeline para um content_item:
//   1. resolve a config (modelo + prompt)
//   2. monta o prompt com placeholders
//   3. chama o Gemini
//   4. registra um pipeline_run (auditoria)
// Retorna o texto bruto da resposta; cada etapa decide como persistir.

import type { PipelineStep, ContentItem, StepConfig } from "./types.ts";
import type { SupabaseAdmin } from "./db.ts";
import { resolveStepConfig, renderTemplate } from "./prompt.ts";
import { callGemini } from "./gemini.ts";

export interface RunStepResult {
  text: string;
  config: StepConfig;
}

export async function runStep(
  db: SupabaseAdmin,
  step: PipelineStep,
  item: ContentItem,
  vars: Record<string, unknown>,
): Promise<RunStepResult> {
  const config = await resolveStepConfig(db, step, item.project_id);
  const userPrompt = renderTemplate(config.user_prompt_template, vars);
  const responseMimeType = (config.extra?.response_mime_type as string) || undefined;

  const start = Date.now();
  let outputText = "";
  let runStatus = "ok";
  let errorMessage: string | null = null;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  // Busca o Treinamento do Negócio (se houver)
  const { data: trainingData } = await db
    .from("business_training")
    .select("*")
    .or(`project_id.eq.${item.project_id},project_id.is.null`);

  let trainingContent = "";
  if (trainingData && trainingData.length > 0) {
    // Prioriza o do projeto, se não, pega o global
    const specific = trainingData.find((t) => t.project_id === item.project_id);
    trainingContent = specific ? specific.content : trainingData[0].content;
  }

  let finalSystemPrompt = config.system_prompt;
  if (trainingContent) {
    finalSystemPrompt += "\n\n=== DIRETRIZES DE TREINAMENTO DO NEGÓCIO ===\n" + trainingContent;
  }

  // Busca a ordem de fallback de modelos dinamicamente
  const { data: aiModelsData } = await db
    .from("ai_models")
    .select("model_id")
    .eq("is_active", true)
    .order("priority", { ascending: true });
    
  const modelsToTry = aiModelsData?.map((m) => m.model_id) || [];

  try {
    const res = await callGemini({
      model: config.model,
      modelsToTry,
      systemPrompt: finalSystemPrompt,
      userPrompt,
      temperature: config.temperature,
      maxOutputTokens: config.max_output_tokens,
      responseMimeType,
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
    error_message: errorMessage,
  });

  if (runStatus === "error") {
    throw new Error(`Etapa ${step} falhou: ${errorMessage}`);
  }
  return { text: outputText, config };
}
