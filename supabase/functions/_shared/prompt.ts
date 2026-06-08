// Resolução de StepConfig (override por projeto ou default global) e
// substituição de placeholders {{...}} no template do prompt.

import type { PipelineStep, StepConfig } from "./types.ts";
import type { SupabaseAdmin } from "./db.ts";

// Busca a config da etapa: prioriza a do projeto; cai para a global (project_id null).
export async function resolveStepConfig(
  db: SupabaseAdmin,
  step: PipelineStep,
  projectId: string,
): Promise<StepConfig> {
  const { data, error } = await db
    .from("step_configs")
    .select("*")
    .eq("step", step)
    .eq("is_active", true)
    .or(`project_id.eq.${projectId},project_id.is.null`);

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`Nenhuma step_config ativa para a etapa "${step}".`);
  }
  // Override do projeto vence o default global.
  const specific = data.find((c) => c.project_id === projectId);
  return (specific ?? data[0]) as StepConfig;
}

// Substitui {{chave}} pelos valores fornecidos. Valores ausentes viram "".
export function renderTemplate(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}
