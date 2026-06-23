import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function editSource(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const pid = String(formData.get("project_id"));
  const sid = String(formData.get("source_id"));
  const { error } = await db.from("sources").update({
    type: String(formData.get("type")),
    name: String(formData.get("name")),
    url: String(formData.get("url")),
    check_interval_minutes: Number(formData.get("interval") || 60),
  }).eq("id", sid);

  if (error) {
    redirect(`/projects/${pid}/source/${sid}?erro=${encodeURIComponent(`Erro ao salvar: ${error.message}`)}`);
  }
  revalidatePath(`/projects/${pid}`);
  redirect(`/projects/${pid}`);
}

export default async function EditSource(
  { params, searchParams }: { params: { id: string; source_id: string }; searchParams: { erro?: string } },
) {
  const db = supabaseAdmin();
  const { data: project } = await db.from("projects").select("name").eq("id", params.id).single();
  const { data: source } = await db.from("sources").select("*").eq("id", params.source_id).single();

  if (!source) return <p>Fonte não encontrada.</p>;

  return (
    <div>
      {searchParams?.erro && (
        <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          {searchParams.erro}
        </div>
      )}
      <h2>Editar Fonte</h2>
      <p className="muted">Projeto: {project?.name}</p>

      <div className="card" style={{ maxWidth: 600 }}>
        <form action={editSource} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="hidden" name="project_id" value={params.id} />
          <input type="hidden" name="source_id" value={params.source_id} />
          
          <label>
            <div>Nome da fonte</div>
            <input name="name" defaultValue={source.name} required style={{ width: "100%" }} />
          </label>
          
          <label>
            <div>Tipo</div>
            <select name="type" defaultValue={source.type} style={{ width: "100%" }}>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="diario_oficial">Diário Oficial</option>
              <option value="website">Site público</option>
            </select>
          </label>
          
          <label>
            <div>URL</div>
            <input name="url" defaultValue={source.url} required style={{ width: "100%" }} />
          </label>
          
          <label>
            <div>Intervalo (minutos)</div>
            <input name="interval" type="number" defaultValue={source.check_interval_minutes} style={{ width: "100%" }} />
          </label>
          
          <div className="row" style={{ marginTop: 16 }}>
            <a href={`/projects/${params.id}`} className="btn secondary">Cancelar</a>
            <button className="btn" type="submit">Salvar Alterações</button>
          </div>
        </form>
      </div>
    </div>
  );
}
