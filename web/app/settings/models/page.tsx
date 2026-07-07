import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function saveModels(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  
  // Extrai os models submetidos (podem ser até 5)
  const selectedModels = [];
  for (let i = 1; i <= 5; i++) {
    const modelId = formData.get(`model_${i}`);
    if (modelId && typeof modelId === "string" && modelId.trim() !== "") {
      selectedModels.push(modelId.trim());
    }
  }

  // Se nenhum modelo foi informado, não apaga tudo, mas levanta erro ou ignora
  if (selectedModels.length === 0) return;

  // Apaga todos os atuais
  await db.from("ai_models").delete().neq("id", "00000000-0000-0000-0000-000000000000"); // hack para deletar todos

  // Insere os novos com prioridade sequencial
  const rows = selectedModels.map((modelId, index) => ({
    name: modelId, // Usamos o ID como name, já que pegamos apenas o value do select
    model_id: modelId,
    priority: index + 1,
    is_active: true
  }));

  await db.from("ai_models").insert(rows);

  revalidatePath("/settings/models");
}

export default async function ModelsSettings() {
  const db = supabaseAdmin();
  
  // Traz os modelos configurados no banco
  const { data: aiModels } = await db
    .from("ai_models")
    .select("*")
    .order("priority", { ascending: true });

  // Busca os modelos da API do OpenRouter
  let openRouterModels: { id: string; name: string }[] = [];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { next: { revalidate: 3600 } });
    if (res.ok) {
      const json = await res.json();
      openRouterModels = json.data || [];
      // Ordena alfabeticamente pelo ID
      openRouterModels.sort((a, b) => a.id.localeCompare(b.id));
    }
  } catch (e) {
    console.error("Falha ao buscar modelos do OpenRouter", e);
  }

  // Prepara as 5 vagas de modelos para o formulário
  const slots = [1, 2, 3, 4, 5];

  return (
    <div>
      <h2>Modelos de IA & Fallback</h2>
      <p className="muted">
        Configure os modelos de IA que serão utilizados pelas etapas do pipeline. O primeiro modelo (Prioridade 1) será o modelo principal. Se ele falhar, o sistema tentará automaticamente o de Prioridade 2, e assim por diante.
      </p>

      <form action={saveModels} className="card" style={{ borderLeft: "4px solid var(--accent)", marginBottom: "2rem" }}>
        <h3>Configuração OpenRouter</h3>
        
        {slots.map((slotIndex) => {
          const currentModel = aiModels?.[slotIndex - 1];
          return (
            <label key={slotIndex} className="field" style={{ marginBottom: "1rem" }}>
              <span>Prioridade {slotIndex} {slotIndex === 1 ? "(Principal)" : "(Fallback)"}</span>
              <select 
                name={`model_${slotIndex}`} 
                defaultValue={currentModel?.model_id ?? ""}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                <option value="">-- Nenhum --</option>
                {openRouterModels.map(m => (
                  <option key={m.id} value={m.id}>{m.id} - {m.name}</option>
                ))}
                {/* Caso o modelo salvo não esteja mais na lista da API, a gente força a exibição dele */}
                {currentModel && !openRouterModels.find(m => m.id === currentModel.model_id) && (
                  <option value={currentModel.model_id}>{currentModel.model_id} (Não listado)</option>
                )}
              </select>
            </label>
          );
        })}
        
        <SubmitButton className="btn" type="submit" style={{ marginTop: "1rem" }}>
          Salvar Ordem de Modelos
        </SubmitButton>
      </form>

      <div className="card muted">
        Nota: Lembre-se de rodar a migração no painel do Supabase criando a tabela <code>ai_models</code> antes de utilizar esta página.
      </div>
    </div>
  );
}
