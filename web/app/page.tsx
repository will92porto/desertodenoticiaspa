import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = supabaseAdmin();

  const [{ count: projects }, { count: sources }, { count: ready }, { count: published }, { count: created }, { count: discarded }] =
    await Promise.all([
      db.from("projects").select("*", { count: "exact", head: true }),
      db.from("sources").select("*", { count: "exact", head: true }),
      db.from("content_items").select("*", { count: "exact", head: true }).eq("status", "ready"),
      db.from("content_items").select("*", { count: "exact", head: true }).eq("status", "published"),
      db.from("content_items").select("*", { count: "exact", head: true }),
      db.from("content_items").select("*", { count: "exact", head: true }).eq("status", "discarded"),
    ]);

  const stats = [
    { label: "Total Captados/Criados", value: created ?? 0 },
    { label: "Rejeitados (Descartados)", value: discarded ?? 0 },
    { label: "Prontas p/ publicar", value: ready ?? 0 },
    { label: "Publicadas", value: published ?? 0 },
    { label: "Projetos", value: projects ?? 0 },
    { label: "Fontes", value: sources ?? 0 },
  ];

  return (
    <div>
      <h2>Visão geral</h2>
      <div className="grid">
        {stats.map((s) => (
          <div className="card" key={s.label}>
            <div className="stat">{s.value}</div>
            <div className="label">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <p className="muted">
          O pipeline roda automaticamente: a captura de fontes ocorre a cada 15 min e o
          orquestrador avança os itens a cada 5 min. Use a aba <strong>Pipeline</strong> para
          acompanhar e acionar etapas manualmente, e <strong>Etapas &amp; Prompts</strong> para
          ajustar modelo e instruções de cada etapa.
        </p>
      </div>
    </div>
  );
}
