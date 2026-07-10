import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function createProject(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const name = String(formData.get("name") || "").trim();
  const slug = String(formData.get("slug") || "").trim() ||
    name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { data: project, error } = await db.from("projects").insert({
    name,
    slug,
    description: String(formData.get("description") || ""),
  }).select("id").single();
  if (error) {
    throw new Error(`Falha ao criar projeto: ${error.message} (code: ${error.code})`);
  }
  // Insere credenciais do WordPress na tabela separada, se fornecidas
  const wpUrl = String(formData.get("wp_url") || "").trim();
  const wpUser = String(formData.get("wp_user") || "").trim();
  const wpSecret = String(formData.get("wp_secret") || "").trim();
  if (wpUrl && wpUser && wpSecret && project?.id) {
    await db.from("wordpress_integrations").insert({
      project_id: project.id,
      url: wpUrl,
      username: wpUser,
      application_password: wpSecret,
    });
  }
  redirect("/projects");
}

export default function NewProject() {
  return (
    <div>
      <h2>Novo projeto</h2>
      <form action={createProject} className="card" style={{ maxWidth: 560 }}>
        <label className="field"><span>Nome</span><input name="name" required /></label>
        <label className="field"><span>Slug (opcional)</span><input name="slug" placeholder="gerado a partir do nome" /></label>
        <label className="field"><span>Descrição</span><textarea name="description" /></label>
        <hr style={{ borderColor: "var(--border)", margin: "16px 0" }} />
        <p className="muted">Conector WordPress (destino de publicação)</p>
        <label className="field"><span>URL base do WordPress</span><input name="wp_url" placeholder="https://meusite.com" /></label>
        <label className="field"><span>Usuário WordPress</span><input name="wp_user" /></label>
        <label className="field">
          <span>Senha de Aplicativo (Application Password)</span>
          <input type="password" name="wp_secret" placeholder="••••••••" />
        </label>
        <SubmitButton className="btn" type="submit">Criar projeto</SubmitButton>
      </form>
    </div>
  );
}
