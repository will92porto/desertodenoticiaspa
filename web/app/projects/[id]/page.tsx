import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function addRegion(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const { error } = await db.from("regions").insert({
    project_id: String(formData.get("project_id")),
    name: String(formData.get("name")),
    state: String(formData.get("state") || "") || null,
  });
  const pid = String(formData.get("project_id"));
  // Em vez de quebrar a página, mostra o erro real na própria tela via query param.
  if (error) {
    redirect(`/projects/${pid}?erro=${encodeURIComponent(`Região: ${error.message} (${error.code})`)}`);
  }
  revalidatePath(`/projects/${pid}`);
}

async function addSource(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const { error } = await db.from("sources").insert({
    region_id: String(formData.get("region_id")),
    type: String(formData.get("type")),
    name: String(formData.get("name")),
    url: String(formData.get("url")),
    check_interval_minutes: Number(formData.get("interval") || 60),
  });
  const pid = String(formData.get("project_id"));
  if (error) {
    redirect(`/projects/${pid}?erro=${encodeURIComponent(`Fonte: ${error.message} (${error.code})`)}`);
  }
  revalidatePath(`/projects/${pid}`);
}

async function deleteSource(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  await db.from("sources").delete().eq("id", String(formData.get("source_id")));
  revalidatePath(`/projects/${String(formData.get("project_id"))}`);
}

async function updateWordPressConfig(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const pid = String(formData.get("project_id"));
  const { error } = await db.from("projects").update({
    wordpress_base_url: String(formData.get("wordpress_base_url") || ""),
    wordpress_username: String(formData.get("wordpress_username") || ""),
    wordpress_app_password_secret: String(formData.get("wordpress_app_password_secret") || ""),
  }).eq("id", pid);
  
  if (error) {
    redirect(`/projects/${pid}?erro=${encodeURIComponent(`WordPress: ${error.message}`)}`);
  }
  revalidatePath(`/projects/${pid}`);
}

export default async function ProjectDetail(
  { params, searchParams }: { params: { id: string }; searchParams: { erro?: string } },
) {
  const db = supabaseAdmin();
  const { data: project } = await db.from("projects").select("*").eq("id", params.id).single();
  const { data: regions } = await db
    .from("regions").select("*, sources(*)").eq("project_id", params.id);

  if (!project) return <p>Projeto não encontrado.</p>;

  return (
    <div>
      {searchParams?.erro && (
        <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          Erro ao salvar — {searchParams.erro}
        </div>
      )}
      <h2>{project.name}</h2>
      <p className="muted">{project.description}</p>

      <div className="card">
        <h3>Sincronização WordPress</h3>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
          Configure as credenciais para publicar os artigos automaticamente como rascunhos. 
          Use uma "Application Password" do WordPress.
        </p>
        <form action={updateWordPressConfig} className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="project_id" value={project.id} />
          
          <label className="field" style={{ flex: "1 1 200px" }}>
            <span>URL do WordPress</span>
            <input name="wordpress_base_url" placeholder="Ex: https://meusite.com.br" defaultValue={project.wordpress_base_url || ""} />
          </label>
          
          <label className="field" style={{ flex: "1 1 150px" }}>
            <span>Usuário</span>
            <input name="wordpress_username" placeholder="Login" defaultValue={project.wordpress_username || ""} />
          </label>
          
          <label className="field" style={{ flex: "1 1 200px" }}>
            <span>Senha de Aplicativo (Application Password)</span>
            <input type="password" name="wordpress_app_password_secret" placeholder="••••••••" defaultValue={project.wordpress_app_password_secret || ""} />
          </label>

          <SubmitButton className="btn" type="submit" style={{ marginBottom: "12px" }}>Salvar WordPress</SubmitButton>
        </form>
      </div>

      <div className="card">
        <h3>Adicionar região</h3>
        <form action={addRegion} className="row">
          <input type="hidden" name="project_id" value={project.id} />
          <input name="name" placeholder="Nome da região (ex.: Sertão Central - CE)" required />
          <input name="state" placeholder="UF" style={{ maxWidth: 80 }} />
          <SubmitButton className="btn" type="submit">Adicionar</SubmitButton>
        </form>
      </div>

      {(regions ?? []).map((r: any) => (
        <div className="card" key={r.id}>
          <h3>{r.name} <span className="badge">{r.state || "—"}</span></h3>

          <table>
            <thead><tr><th>Fonte</th><th>Tipo</th><th>URL</th><th>Intervalo</th><th style={{ width: 150 }}>Ações</th></tr></thead>
            <tbody>
              {(r.sources ?? []).map((s: any) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td><span className="badge">{s.type}</span></td>
                  <td className="muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{s.url}</td>
                  <td>{s.check_interval_minutes} min</td>
                  <td>
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                      <a href={`/projects/${project.id}/source/${s.id}`} className="btn secondary" style={{ padding: "4px 8px", fontSize: 12, height: "auto" }}>Editar</a>
                      <form action={deleteSource}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="source_id" value={s.id} />
                        <SubmitButton className="btn" style={{ background: "transparent", color: "var(--red)", borderColor: "var(--red)", padding: "4px 8px", fontSize: 12, height: "auto" }} confirmMessage={`Tem certeza que deseja remover a fonte "${s.name}"?`}>Excluir</SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {(!r.sources || r.sources.length === 0) && (
                <tr><td colSpan={5} className="muted">Sem fontes nesta região.</td></tr>
              )}
            </tbody>
          </table>

          <form action={addSource} className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <input type="hidden" name="project_id" value={project.id} />
            <input type="hidden" name="region_id" value={r.id} />
            <input name="name" placeholder="Nome da fonte" required style={{ maxWidth: 180 }} />
            <select name="type" style={{ maxWidth: 160 }}>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="diario_oficial">Diário Oficial</option>
              <option value="website">Site público</option>
            </select>
            <input name="url" placeholder="URL" required style={{ maxWidth: 260 }} />
            <input name="interval" type="number" defaultValue={60} style={{ maxWidth: 90 }} />
            <SubmitButton className="btn secondary" type="submit">+ Fonte</SubmitButton>
          </form>
        </div>
      ))}
    </div>
  );
}
