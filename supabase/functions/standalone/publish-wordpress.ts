// ============================================================================
// PUBLICAÇÃO no WordPress  (ARQUIVO ÚNICO para o editor web)
// Cole TODO este conteúdo no editor da função "publish-wordpress".
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
function mdToHtml(md: string): string {
  const out: string[] = [];
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); continue; }
    if (line.trim() === "") { out.push(""); continue; }
    const t = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
    out.push(`<p>${t}</p>`);
  }
  return out.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { content_item_id, status = "draft" } = await req.json();
    const db = adminClient();
    const { data: item, error } = await db.from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);
    if (item.status !== "ready") return json({ error: `item não está 'ready' (status: ${item.status})` }, 409);

    const { data: project } = await db.from("projects").select("*").eq("id", item.project_id).single();
    if (!project?.wordpress_base_url) return json({ error: "projeto sem WordPress configurado" }, 400);

    const appPw = Deno.env.get(project.wordpress_app_password_secret ?? "") ?? Deno.env.get("WORDPRESS_APP_PASSWORD");
    if (!appPw) return json({ error: "senha de aplicação do WordPress ausente" }, 400);

    const seo = item.seo ?? {};
    const auth = btoa(`${project.wordpress_username}:${appPw}`);
    const endpoint = `${project.wordpress_base_url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

    await db.from("content_items").update({ status: "publishing" }).eq("id", content_item_id);

    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({
        title: seo.title || item.title || "Sem título", slug: seo.slug || undefined,
        content: mdToHtml(item.final_article ?? ""), excerpt: seo.meta_description || undefined, status,
      }),
    });
    const wpBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      await db.from("content_items").update({ status: "ready", error_message: `WP ${res.status}` }).eq("id", content_item_id);
      await db.from("publications").insert({ content_item_id, project_id: item.project_id, status: "failed", response: wpBody });
      return json({ error: "falha ao publicar", wp: wpBody }, 502);
    }

    await db.from("content_items").update({ status: "published" }).eq("id", content_item_id);
    await db.from("publications").insert({
      content_item_id, project_id: item.project_id, wordpress_post_id: String(wpBody.id ?? ""),
      wordpress_url: wpBody.link ?? null, status: "published", response: wpBody, published_at: new Date().toISOString(),
    });
    return json({ ok: true, wordpress_url: wpBody.link, post_id: wpBody.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
