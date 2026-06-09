import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function createProject(formData: FormData) {
  "use server";
  const db = supabaseAdmin();
  const name = String(formData.get("name") || "").trim();
  const slug = String(formData.get("slug") || "").trim() ||
    name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { error } = await db.from("projects").insert({
    name,
    slug,
    description: String(formData.get("description") || ""),
    wordpress_base_url: String(formData.get("wp_url") || "") || null,
    wordpress_username: String(formData.get("wp_user") || "") || null,
    wordpress_app_password_secret: String(formData.get("wp_secret") || "") || null,
  });
  // Não mascara falha: se o insert falhar (RLS, env faltando, tabela ausente),
  // o erro aparece em vez de redirecionar como se tivesse salvo.
  if (error) {
    throw new Error(`Falha ao criar projeto: ${error.message} (code: ${error.code})`);
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
          <span>Nome do secret da Application Password</span>
          <input name="wp_secret" placeholder="ex.: WP_APP_PW_PROJETO1" />
        </label>
        <button className="btn" type="submit">Criar projeto</button>
      </form>
    </div>
  );
}
