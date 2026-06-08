// PUBLICAÇÃO — envia um content_item "ready" para o WordPress via REST API.
// Recebe { content_item_id, status? }. status default "draft" no WP (revisão humana).
// Usa as credenciais do projeto (Application Password do WordPress).

import { adminClient } from "../_shared/db.ts";
import { json, handleOptions } from "../_shared/http.ts";
import type { ContentItem } from "../_shared/types.ts";

// Markdown -> HTML mínimo para o WordPress (títulos, parágrafos, ênfase).
function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); continue; }
    if (line.trim() === "") { out.push(""); continue; }
    let t = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
    out.push(`<p>${t}</p>`);
  }
  return out.join("\n");
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const { content_item_id, status = "draft" } = await req.json();
    const db = adminClient();

    const { data: item, error } = await db
      .from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);
    if ((item as ContentItem).status !== "ready") {
      return json({ error: `item não está 'ready' (status: ${item.status})` }, 409);
    }

    const { data: project } = await db
      .from("projects").select("*").eq("id", (item as ContentItem).project_id).single();
    if (!project?.wordpress_base_url) {
      return json({ error: "projeto sem WordPress configurado" }, 400);
    }

    // Application Password guardada como secret nomeado em wordpress_app_password_secret.
    const appPw = Deno.env.get(project.wordpress_app_password_secret ?? "") ??
                  Deno.env.get("WORDPRESS_APP_PASSWORD");
    if (!appPw) return json({ error: "senha de aplicação do WordPress ausente" }, 400);

    const seo = (item.seo ?? {}) as Record<string, string>;
    const auth = btoa(`${project.wordpress_username}:${appPw}`);
    const endpoint = `${project.wordpress_base_url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

    await db.from("content_items").update({ status: "publishing" }).eq("id", content_item_id);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({
        title: seo.title || item.title || "Sem título",
        slug: seo.slug || undefined,
        content: mdToHtml(item.final_article ?? ""),
        excerpt: seo.meta_description || undefined,
        status, // draft (revisão) ou publish
      }),
    });

    const wpBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      await db.from("content_items").update({ status: "ready", error_message: `WP ${res.status}` }).eq("id", content_item_id);
      await db.from("publications").insert({
        content_item_id, project_id: item.project_id, status: "failed", response: wpBody,
      });
      return json({ error: "falha ao publicar", wp: wpBody }, 502);
    }

    await db.from("content_items").update({ status: "published" }).eq("id", content_item_id);
    await db.from("publications").insert({
      content_item_id,
      project_id: item.project_id,
      wordpress_post_id: String(wpBody.id ?? ""),
      wordpress_url: wpBody.link ?? null,
      status: "published",
      response: wpBody,
      published_at: new Date().toISOString(),
    });

    return json({ ok: true, wordpress_url: wpBody.link, post_id: wpBody.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
