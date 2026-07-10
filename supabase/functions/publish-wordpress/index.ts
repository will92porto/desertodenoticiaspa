// PUBLICAÇÃO — envia um content_item "ready" para o WordPress via REST API.
// Recebe { content_item_id, status? }. status default "draft" no WP (revisão humana).
// Usa as credenciais do projeto (tabela wordpress_integrations).
//
// AUTOCONTIDA: sem imports de ../_shared para permitir deploy pelo dashboard
// do Supabase, que não empacota arquivos fora da pasta da função.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Markdown -> HTML mínimo para o WordPress (títulos, parágrafos, ênfase).
function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`); continue; }
    if (line.trim() === "") { out.push(""); continue; }
    const t = line
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
    out.push(`<p>${t}</p>`);
  }
  return out.join("\n");
}

// Extrai a manchete (primeiro título H1/H2 do markdown) e devolve o corpo sem ela,
// para o WP não repetir a manchete dentro do conteúdo.
function splitHeadline(md: string): { headline: string | null; body: string } {
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    const h = trimmed.match(/^#{1,2}\s+(.*)$/);
    if (h) {
      return { headline: h[1].trim(), body: lines.slice(i + 1).join("\n").trim() };
    }
    break; // primeiro conteúdo não é título — mantém tudo
  }
  return { headline: null, body: md };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { content_item_id, status = "draft" } = await req.json();
    const db = adminClient();

    const { data: item, error } = await db
      .from("content_items").select("*").eq("id", content_item_id).single();
    if (error || !item) return json({ error: "content_item não encontrado" }, 404);
    if (item.status !== "ready") {
      return json({ error: `item não está 'ready' (status: ${item.status})` }, 409);
    }

    // Busca credenciais do WordPress na tabela wordpress_integrations
    const { data: wpIntegration } = await db
      .from("wordpress_integrations").select("*")
      .eq("project_id", item.project_id).single();
    if (!wpIntegration?.url) {
      return json({ error: "projeto sem WordPress configurado" }, 400);
    }

    const appPw = wpIntegration.application_password ||
                  Deno.env.get("WORDPRESS_APP_PASSWORD");
    if (!appPw) return json({ error: "senha de aplicação do WordPress ausente" }, 400);

    const seo = (item.seo ?? {}) as Record<string, string>;
    const { headline, body } = splitHeadline(item.final_article ?? "");
    const auth = btoa(`${wpIntegration.username}:${appPw}`);
    const endpoint = `${wpIntegration.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

    await db.from("content_items").update({ status: "publishing" }).eq("id", content_item_id);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${auth}` },
      body: JSON.stringify({
        // Prioridade: manchete do próprio artigo > título de SEO > título da fonte
        title: headline || seo.title || item.title || "Sem título",
        slug: seo.slug || undefined,
        content: mdToHtml(body),
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
