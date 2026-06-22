import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ResultadosPage() {
  const db = supabaseAdmin();
  // Busca os conteúdos que já estão finalizados
  const { data: items } = await db
    .from("content_items")
    .select("id, title, final_article, status, regions(name)")
    .in("status", ["ready", "publishing", "published"])
    .order("updated_at", { ascending: false });

  return (
    <div>
      <h2>Resultados</h2>
      <p className="muted">Conteúdos prontos para publicação, já formatados e finalizados pela IA.</p>
      
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "2rem" }}>
        {(items ?? []).map((it: any) => (
          <div className="card" key={it.id}>
            <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>{it.title || "(sem título)"}</h3>
              <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
                Região: {it.regions?.name ?? "—"} • Status: <span className="badge">{it.status}</span>
              </p>
            </div>
            {it.final_article ? (
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {it.final_article}
              </div>
            ) : (
              <p className="muted">Conteúdo ainda não formatado.</p>
            )}
          </div>
        ))}

        {(!items || items.length === 0) && (
          <div className="card muted">Nenhum resultado finalizado encontrado ainda.</div>
        )}
      </div>
    </div>
  );
}
