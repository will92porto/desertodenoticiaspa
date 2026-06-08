import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STEP_TITLE: Record<string, string> = {
  understand: "1 · Entendimento / transcrição",
  rank: "2 · Ranking de pautas (Discover/Pesquisa)",
  write: "3 · Escrita",
  polish: "4 · Polimento editorial + SEO",
};

async function saveConfig(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  await db.from("step_configs").update({
    model: String(formData.get("model")),
    temperature: Number(formData.get("temperature")),
    max_output_tokens: Number(formData.get("max_output_tokens")),
    system_prompt: String(formData.get("system_prompt")),
    user_prompt_template: String(formData.get("user_prompt_template")),
  }).eq("id", String(formData.get("id")));
  revalidatePath("/settings/steps");
}

export default async function StepsSettings() {
  const db = supabaseAdmin();
  // Mostra os defaults globais (project_id null), na ordem das etapas.
  const { data: configs } = await db
    .from("step_configs").select("*").is("project_id", null);

  const order = ["understand", "rank", "write", "polish"];
  const sorted = (configs ?? []).sort(
    (a: any, b: any) => order.indexOf(a.step) - order.indexOf(b.step),
  );

  return (
    <div>
      <h2>Etapas &amp; Prompts</h2>
      <p className="muted">
        Configuração padrão (global) de cada etapa. Cada projeto pode sobrescrever depois.
        Placeholders no template do usuário, ex.: <code>{"{{summary}}"}</code>, <code>{"{{transcript}}"}</code>.
      </p>

      {sorted.map((c: any) => (
        <form action={saveConfig} className="card" key={c.id}>
          <input type="hidden" name="id" value={c.id} />
          <h3>{STEP_TITLE[c.step] ?? c.step}</h3>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <label className="field" style={{ flex: 1, minWidth: 220 }}>
              <span>Modelo (Gemini)</span>
              <input name="model" defaultValue={c.model} />
            </label>
            <label className="field" style={{ width: 120 }}>
              <span>Temperatura</span>
              <input name="temperature" type="number" step="0.1" defaultValue={c.temperature} />
            </label>
            <label className="field" style={{ width: 140 }}>
              <span>Max tokens</span>
              <input name="max_output_tokens" type="number" defaultValue={c.max_output_tokens} />
            </label>
          </div>
          <label className="field">
            <span>System prompt (papel / regras)</span>
            <textarea name="system_prompt" defaultValue={c.system_prompt} style={{ minHeight: 160 }} />
          </label>
          <label className="field">
            <span>User prompt template</span>
            <textarea name="user_prompt_template" defaultValue={c.user_prompt_template} />
          </label>
          <button className="btn" type="submit">Salvar etapa</button>
        </form>
      ))}

      {sorted.length === 0 && (
        <div className="card muted">
          Nenhuma configuração encontrada. Rode <code>supabase/seed.sql</code> para criar os defaults.
        </div>
      )}
    </div>
  );
}
