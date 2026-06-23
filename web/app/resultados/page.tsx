import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ResultadosPage() {
  const db = supabaseAdmin();
  // Busca os últimos 10 conteúdos que já estão finalizados
  const { data: items } = await db
    .from("content_items")
    .select("id, title, final_article, status, regions(name)")
    .in("status", ["ready", "publishing", "published"])
    .order("updated_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h2>Resultados</h2>
      <p className="muted">Últimos 10 conteúdos prontos para publicação, já formatados e finalizados pela IA.</p>
      
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "2rem" }}>
        {(items ?? []).map((it: any) => (
          <details className="card" key={it.id} style={{ padding: "1rem", cursor: "pointer" }}>
            <summary style={{ outline: "none", fontWeight: 500, fontSize: "1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{it.title || "(sem título)"}</span>
              <span className="badge">{it.status}</span>
            </summary>
            
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", cursor: "auto" }}>
              <p className="muted" style={{ margin: "0 0 1rem 0", fontSize: "0.9rem" }}>
                Região: {it.regions?.name ?? "—"}
              </p>
              {it.final_article ? (
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "0.95rem" }}>
                  {it.final_article}
                </div>
              ) : (
                <p className="muted">Conteúdo ainda não formatado.</p>
              )}
            </div>
          </details>
        ))}

        {(!items || items.length === 0) && (
          <div className="card muted">Nenhum resultado finalizado encontrado ainda.</div>
        )}
      </div>
    </div>
  );
}
